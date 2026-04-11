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

class ElemaudioOscilloscope extends HTMLElement {
    private _canvas: HTMLCanvasElement | null = null;
    private _ctx: CanvasRenderingContext2D | null = null;
    private _raf: number | null = null;
    private _dpr: number = 1;

    private _history: number[] = [];
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
        const ctx = this._canvas.getContext("2d");
        if (!ctx) throw new Error("Failed to get 2d canvas context");
        this._ctx = ctx;
        const r = this._canvas.getBoundingClientRect();

        const dpr = window.devicePixelRatio ?? 1;
        this._dpr = dpr;

        // Backing store in device pixels for crisp drawing on HiDPI.
        this._canvas.width = Math.max(1, Math.floor(r.width * dpr));
        this._canvas.height = Math.max(1, Math.floor(r.height * dpr));
        this._canvas.style.width = `${r.width}px`;
        this._canvas.style.height = `${r.height}px`;

        // Draw in CSS pixel coordinates.
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
