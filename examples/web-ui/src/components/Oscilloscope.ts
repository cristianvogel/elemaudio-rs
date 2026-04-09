/*
 * Minimal canvas oscilloscope web component (no React).
 *
 * Intended use:
 *   <elemaudio-oscilloscope width="340" height="160" color="#6ea8fe"></elemaudio-oscilloscope>
 *   oscilloscopeEl.data = [{ min, max }]; // from renderer.on('meter')
 */

type MeterRange = { min: number; max: number };
type ScopePoint = MeterRange | null | undefined;

type ScopeSample = number;

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

  static get observedAttributes() {
    return ["color", "bg", "width", "height"]; // width/height are reflected via attrs
  }

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
      canvas.id = "scope-canvas";
      this.appendChild(canvas);
      this._canvas = canvas;
    }

    // Respect explicit width/height attributes.
    const wAttr = this.getAttribute("width");
    const hAttr = this.getAttribute("height");
    if (wAttr) this._canvas.width = Number(wAttr);
    if (hAttr) this._canvas.height = Number(hAttr);

    this._canvas.style.width = this._canvas.width + "px";
    this._canvas.style.height = this._canvas.height + "px";

    const ctx = this._canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2d canvas context");
    this._ctx = ctx;
  }

  set data(value: ScopePoint[] | number[] ) {
    // eslint-disable-next-line no-console
    // console.log("Oscilloscope.data set", Array.isArray(value) ? value.length : value);
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
    // Samples are typically in [-1, 1]. Clamp to avoid out-of-range explosions.
    const amplitudeScale = height * 0.42;

    const color = this.getAttribute("color") ?? "#6ea8fe";
    const bg = this.getAttribute("bg") ?? "rgba(10, 14, 20, 0.85)";

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = (i * width) / 4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const y = (i * height) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Middle line (0)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Plot
    if (Array.isArray(this._data) && (this._data.length === 0)) {
      return;
    }

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

    const range = (this._data as ScopePoint[]).find((p): p is MeterRange => !!p) ?? null;

    if (!range) return;

    // Use a bar in the center of the canvas.
    const yMin = mapValueToY(range.min, height);
    const yMax = mapValueToY(range.max, height);
    const top = Math.min(yMin, yMax);
    const bottom = Math.max(yMin, yMax);

    // Vertical gradient line
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(110, 168, 254, 0.15)");

    const x = width / 2;
    const barW = Math.max(2, Math.floor(width * 0.08));

    ctx.fillStyle = grad;
    ctx.fillRect(x - barW / 2, top, barW, Math.max(1, bottom - top));

    // End caps
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - barW, top);
    ctx.lineTo(x + barW, top);
    ctx.moveTo(x - barW, bottom);
    ctx.lineTo(x + barW, bottom);
    ctx.stroke();
  }
}


if (!customElements.get("elemaudio-oscilloscope")) {
  customElements.define("elemaudio-oscilloscope", ElemaudioOscilloscope);
}
