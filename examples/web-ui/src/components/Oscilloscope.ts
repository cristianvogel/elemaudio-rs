/*
 * Signal oscilloscope for el.scope block data.
 *
 * The DSP core emits blocks of samples via `el.scope({name:"…"}, signal)`.
 * Each event contains data as Array<Array<number>> (one block per channel).
 * This component accepts a single block of samples and plots them in a
 * circular buffer with zoom support and a freeze option.
 *
 * Usage:
 *   <elemaudio-oscilloscope></elemaudio-oscilloscope>
 *   <elemaudio-oscilloscope zoom="4"></elemaudio-oscilloscope>
 *   <elemaudio-oscilloscope freeze></elemaudio-oscilloscope>
 */


export const TIME_SCALE = 1024;
export const MAX_ZOOM = 128;
// Maximum capacity based on max zoom (TIME_SCALE * MAX_ZOOM)
export const MAX_CAPACITY = TIME_SCALE * MAX_ZOOM;

class ElemaudioOscilloscope extends HTMLElement {
    private _canvas: HTMLCanvasElement | null = null;
    private _ctx: CanvasRenderingContext2D | null = null;
    private _gl: WebGLRenderingContext | null = null;
    private _program: WebGLProgram | null = null;
    private _buffer: WebGLBuffer | null = null;
    private _raf: number | null = null;
    private _dpr: number = 1;

    private _history: number[] = [];
  // GPU side interleaved buffer (index, value) for max capacity
  private _gpuVertices: Float32Array = new Float32Array(MAX_CAPACITY * 2);
    private _capacity: number = TIME_SCALE;
    private _zoom: number = 1;
    private _frozen: boolean = false;

    static get observedAttributes() {
        return ["zoom", "color", "bg", "freeze"];
    }

    constructor() {
        super();
    }

    connectedCallback() {
        this._ensureCanvas();
        this._scheduleDraw();
    }

    attributeChangedCallback(name: string) {
        if (name === "zoom") {
            const z = Number(this.getAttribute("zoom"));
            this._zoom = Number.isFinite(z) && z > 0 ? z : 1;
            this._capacity = Math.ceil(TIME_SCALE * this._zoom);
            if (this._history.length > this._capacity) {
                this._history = this._history.slice(-this._capacity);
            }
        } else if (name === "freeze") {
            this._frozen = this.hasAttribute("freeze");
        }
        this._scheduleDraw();
    }

    private _ensureCanvas() {
        if (this._canvas) return;
        const existing = this.querySelector("canvas");
        if (existing instanceof HTMLCanvasElement) {
            this._canvas = existing;
        } else {
            const c = document.createElement("canvas");
            this.appendChild(c);
            this._canvas = c;
        }
        this._canvas.id = "scope-canvas";
        // Try WebGL first, fall back to 2D
        const gl = this._canvas.getContext("webgl2") as WebGLRenderingContext | null || this._canvas.getContext("webgl") as WebGLRenderingContext | null;
        if (gl) {
          this._gl = gl;
          // Simple shader program
          const vert = `
            attribute float a_index;
            attribute float a_value;
            uniform float u_len;
            uniform float u_zoom;
            uniform vec2 u_resolution;
            void main() {
              float x = (a_index / (u_len - 1.0)) * 2.0 - 1.0;
              float y = a_value;
              gl_Position = vec4(x, y, 0.0, 1.0);
            }
          `;
          const frag = `
            precision mediump float;
            uniform vec3 u_color;
            void main() {
              gl_FragColor = vec4(u_color, 1.0);
            }
          `;
          const vShader = gl.createShader(gl.VERTEX_SHADER);
          const fShader = gl.createShader(gl.FRAGMENT_SHADER);
          const prog = gl.createProgram();

          if (!vShader || !fShader || !prog) {
            console.error("Failed to create WebGL shaders or program");
            this._setupFallback2D();
            return;
          }

          gl.shaderSource(vShader, vert);
          gl.compileShader(vShader);
          gl.shaderSource(fShader, frag);
          gl.compileShader(fShader);
          
          gl.attachShader(prog, vShader);
          gl.attachShader(prog, fShader);
          gl.linkProgram(prog);

          if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error("Failed to link WebGL program:", gl.getProgramInfoLog(prog));
            this._setupFallback2D();
            return;
          }

          this._program = prog;
          this._buffer = gl.createBuffer();
          if (!this._buffer) {
            console.error("Failed to create WebGL buffer");
            this._setupFallback2D();
            return;
          }

          // Allocate buffer for max capacity (interleaved index/value)
          gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
          gl.bufferData(gl.ARRAY_BUFFER, MAX_CAPACITY * 2 * 4, gl.DYNAMIC_DRAW);
        } else {
          this._setupFallback2D();
        }
        const r = this._canvas.getBoundingClientRect();

        const dpr = window.devicePixelRatio ?? 1;
        this._dpr = dpr;

        // Backing store in device pixels for crisp drawing on HiDPI.
        this._canvas.width = Math.max(1, Math.floor(r.width * dpr));
        this._canvas.height = Math.max(1, Math.floor(r.height * dpr));
        this._canvas.style.width = `${r.width}px`;
        this._canvas.style.height = `${r.height}px`;

        // Draw in CSS pixel coordinates.
        if (this._ctx) {
          this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }

    private _setupFallback2D() {
      if (!this._canvas) return;
      const ctx = this._canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2d canvas context");
      this._ctx = ctx;
      this._gl = null;
      this._program = null;
      this._buffer = null;
    }

    /** Accept a block of samples from el.scope (a number[]). */
    set data(value: number[]) {
        if (this._frozen) return;
        if (!Array.isArray(value)) return;

        // el.scope emits small blocks over time.
        // Zoom is expected to increase the visible time window by keeping more
        // history; therefore blocks must be accumulated.
        const block = value as number[];
        if (this._history.length === 0) {
          this._history = block;
        } else {
          this._history.push(...block);
          if (this._history.length > this._capacity) {
            this._history = this._history.slice(-this._capacity);
          }
        }
        // Upload new block to GPU using persistent buffer
        if (this._gl && this._program && this._buffer) {
          const gl = this._gl;
          const len = this._history.length;
          // Fill interleaved index/value for the whole history (max capacity)
          const vertices = this._gpuVertices;
          for (let i = 0; i < len; i++) {
            vertices[i * 2] = i; // index
            vertices[i * 2 + 1] = this._history[i]; // value
          }
          // Update only the used portion of the buffer
          gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, len * 2));
        }
        this._scheduleDraw();

    }

    get data(): number[] {
        return this._history;
    }

    private _scheduleDraw() {
        if (this._raf != null) return;
        this._raf = requestAnimationFrame(() => {
            this._raf = null;
            this._draw();
        });
    }

    private _draw() {
        // If WebGL is available, draw using it
        if (this._gl && this._program && this._buffer && this._canvas) {
          const gl = this._gl;
          gl.viewport(0, 0, this._canvas.width, this._canvas.height);
          gl.clearColor(0.0, 0.0, 0.0, 0.0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.useProgram(this._program);
          // Attributes
          const aIndex = gl.getAttribLocation(this._program, "a_index");
          const aValue = gl.getAttribLocation(this._program, "a_value");
          const len = this._history.length;
          if (len === 0) return;
          gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
          // Enable and set attribute pointers (interleaved index/value)
          gl.enableVertexAttribArray(aIndex);
          gl.vertexAttribPointer(aIndex, 1, gl.FLOAT, false, 8, 0);
          gl.enableVertexAttribArray(aValue);
          gl.vertexAttribPointer(aValue, 1, gl.FLOAT, false, 8, 4);
          // Uniforms
          const uLen = gl.getUniformLocation(this._program, "u_len");
          gl.uniform1f(uLen, len);
          const uZoom = gl.getUniformLocation(this._program, "u_zoom");
          gl.uniform1f(uZoom, this._zoom);
          const uRes = gl.getUniformLocation(this._program, "u_resolution");
          gl.uniform2f(uRes, this._canvas.width / this._dpr, this._canvas.height / this._dpr);
          const color = this.getAttribute("color") ?? "#6ea8fe";
          const r = parseInt(color.slice(1, 3), 16) / 255;
          const g = parseInt(color.slice(3, 5), 16) / 255;
          const b = parseInt(color.slice(5, 7), 16) / 255;
          const uColor = gl.getUniformLocation(this._program, "u_color");
          gl.uniform3f(uColor, r, g, b);
          gl.drawArrays(gl.LINE_STRIP, 0, len);
          return;
        }
        // Fallback 2D drawing
        if (!this._canvas || !this._ctx) return;
        const c = this._canvas;
        const ctx = this._ctx;
        const w = c.width / this._dpr;
        const h = c.height / this._dpr;
        const midY = h * 0.5;
        const amp = h * 0.45;

        const color = this.getAttribute("color") ?? "#6ea8fe";
        const bg = this.getAttribute("bg") ?? "rgba(10,14,20,0.05)";

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // Centre line with fade gradient
        const fade = ctx.createLinearGradient(0, 0, w, 0);
        fade.addColorStop(0, "transparent");
        fade.addColorStop(0.3, "rgba(255,255,255,0.12)");
        ctx.strokeStyle = fade;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(w, midY);
        ctx.stroke();

        if (this._history.length === 0) return;

        const sliceW = w / Math.max(1, this._history.length - 1);
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, "transparent");
        grad.addColorStop(0.3, color);
        grad.addColorStop(1, color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let i = 0; i < this._history.length; i++) {
          const x = i * sliceW;
          const v = Math.max(-1, Math.min(1, this._history[i]));
          const y = midY - v * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

    }
}

if (!customElements.get("elemaudio-oscilloscope")) {
    customElements.define("elemaudio-oscilloscope", ElemaudioOscilloscope);
}
