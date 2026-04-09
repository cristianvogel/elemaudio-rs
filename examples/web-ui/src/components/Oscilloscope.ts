/*
 * Minimal canvas oscilloscope web component (no React).
 *
 * Intended use:
 *   <elemaudio-oscilloscope width="340" height="160" color="#6ea8fe"></elemaudio-oscilloscope>
 *   oscilloscopeEl.data = [{ min, max }]; // from renderer.on('meter')
 */

type MeterRange = { min: number; max: number };
type ScopePoint = MeterRange | null | undefined;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function mapValueToY(value: number, height: number) {
  // value in [-1, 1] -> y in [height, 0]
  const n = clamp01((value + 1) / 2);
  return height - n * height;
}

class ElemaudioOscilloscope extends HTMLElement {
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _raf: number | null = null;

  // The latest “batch” pushed by the demo.
  // Supported shapes:
  // - [{min,max}] from meter events
  // - number[] from scope events (waveform samples)
  private _data: ScopePoint[] | number[] = [];


  constructor() {
    super();
  }

  connectedCallback() {
    this._ensureCanvas();
    this._scheduleDraw();
  }

  attributeChangedCallback() {
    this._scheduleDraw();
  }

  private _ensureCanvas() {
    if (this._canvas) return;
    const existingCanvas = this.querySelector("canvas");
    if (existingCanvas instanceof HTMLCanvasElement) {
      this._canvas = existingCanvas;
    } else {
        const canvas = document.createElement("canvas");
        this.appendChild(canvas);
        this._canvas = canvas;
    }
      this._canvas.id = "scope-canvas";

    const ctx = this._canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d canvas context");
    this._ctx = ctx;
    const rect = this._canvas.getBoundingClientRect();
    this._canvas.width = Math.max(1, Math.floor(rect.width));
    this._canvas.height = Math.max(1, Math.floor(rect.height));
    this._canvas.style.width = `${rect.width}px`;
    this._canvas.style.height = `${rect.height}px`;
  }

  set data(value: ScopePoint[] | number[] ) {
      this._data = value ?? [];
    this._scheduleDraw();
  }

  get data() {
    return this._data;
  }

  private _scheduleDraw() {
    if (this._raf != null) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  private _draw() {
    if (!this._canvas || !this._ctx) return;

    const canvas = this._canvas;
    const ctx = this._ctx;
    const width = canvas.width;
    const height = canvas.height;
    const midY = height * 0.5;
    const amplitudeScale = height * 0.45;

    const color = this.getAttribute("color") ?? "#6ea8fe";
    const bg = this.getAttribute("bg") ?? "rgba(10, 14, 20, 0.05)";

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;


    // Middle line (0)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();


    if (Array.isArray(this._data) && typeof (this._data as any)[0] === "number") {
      // Waveform samples: plot a line across the canvas.
      const samples = this._data as number[];
      const sliceWidth = width / samples.length;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = i * sliceWidth;
        const v = Math.max(-1, Math.min(1, samples[i]));
        const y = midY - v * amplitudeScale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }
  }
}


if (!customElements.get("elemaudio-oscilloscope")) {
  customElements.define("elemaudio-oscilloscope", ElemaudioOscilloscope);
}
