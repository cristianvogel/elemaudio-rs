/*
 * Minimal canvas signal scope, history 500 * 256 samples
 */

type MeterRange = { min: number; max: number };
type ScopePoint = MeterRange | null | undefined;

export const TIME_SCALE = 1024; // min 256

class ElemaudioOscilloscope extends HTMLElement {
    private _canvas: HTMLCanvasElement | null = null;
    private _ctx: CanvasRenderingContext2D | null = null;
    private _raf: number | null = null;

    // The latest “batch” pushed by the demo.
    // Supported shapes:
    // - [{min,max}] from meter events
    // - number[] from scope events (waveform samples)
    private _data: ScopePoint[] | number[] = [];

    private _sampleHistory: number[] = [];
    private readonly _historyLength = TIME_SCALE / 4 ;
    private _blockCount = 0;


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

    set data(value: ScopePoint[] | number[]) {
        this._data = value ?? [];
        if (Array.isArray(value) && typeof value[0] === "number") {
            this._sampleHistory.push(...(value as number[]));
            if (this._sampleHistory.length > this._historyLength) {
                this._sampleHistory = this._sampleHistory.slice(-this._historyLength);
            }
            this._blockCount = (this._blockCount + 1) % TIME_SCALE;
        }
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

        // 1. Background (Static)
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);

        // 2. Prepare the Shared Fade Gradient
        // This gradient goes from transparent on the left to fully visible on the right
        const fadeGradient = ctx.createLinearGradient(0, 0, width, 0);
        fadeGradient.addColorStop(0, "transparent");
        fadeGradient.addColorStop(0.3, "rgba(255, 255, 255, 0.12)"); // Zero line visibility

        // 3. Draw Middle line (0) with the fade
        ctx.strokeStyle = fadeGradient;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, midY);
        ctx.lineTo(width, midY);
        ctx.stroke();

        if (this._sampleHistory.length > 0) {
            const samples = this._sampleHistory;
            const ordered = samples.slice(-this._historyLength);
            const sliceWidth = width / Math.max(1, ordered.length - 1);

            // 4. Create a specific gradient for the Waveform
            // We use the same stops so the fade-in point matches the zero line
            const waveGradient = ctx.createLinearGradient(0, 0, width, 0);
            waveGradient.addColorStop(0, "transparent");
            waveGradient.addColorStop(0.3, color);
            waveGradient.addColorStop(1, color);

            ctx.strokeStyle = waveGradient;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < ordered.length; i++) {
                const x = i * sliceWidth;
                const v = Math.max(-1, Math.min(1, ordered[i]));
                const y = midY - v * amplitudeScale;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    }
}


if (!customElements.get("elemaudio-oscilloscope")) {
  customElements.define("elemaudio-oscilloscope", ElemaudioOscilloscope);
}
