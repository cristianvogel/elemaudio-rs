import invariant from "invariant";
import EventEmitter from "eventemitter3";
import { Renderer } from "@elem-rs/core";
import WorkletProcessor from "../shims/WorkletProcessor";
import WasmModule from "../shims/elementary-wasm";

const pkgVersion = "dev";

export default class WebRenderer extends EventEmitter {
  private _worklet: AudioWorkletNode | null = null;
  private _promiseMap: Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }> | null = null;
  private _nextRequestId = 0;
  private _renderer: Renderer | null = null;
  private _timer: number | null = null;

  public context: AudioContext | null = null;

  async initialize(audioContext: AudioContext, workletOptions: AudioWorkletNodeOptions = {}, eventInterval: number = 16) {
    invariant(typeof audioContext === "object" && audioContext !== null, "First argument to initialize must be a valid AudioContext instance.");
    invariant(typeof workletOptions === "object" && workletOptions !== null, "The optional second argument to initialize must be an object.");

    this.context = audioContext;

    // @ts-expect-error - browser-only field used by the vendored runtime.
    if (typeof audioContext._elemWorkletRegistry !== "object") {
      // @ts-expect-error - browser-only field used by the vendored runtime.
      audioContext._elemWorkletRegistry = {};
    }

    // @ts-expect-error - browser-only field used by the vendored runtime.
    const workletRegistry = audioContext._elemWorkletRegistry;

    if (!workletRegistry.hasOwnProperty(pkgVersion)) {
      const blob = new Blob([
        WasmModule,
        WorkletProcessor,
      ], { type: "text/javascript" });

      const blobUrl = URL.createObjectURL(blob);

      if (!audioContext.audioWorklet) {
        throw new Error("BaseAudioContext.audioWorklet is missing; are you running in a secure context (https)?");
      }

      await audioContext.audioWorklet.addModule(blobUrl);
      workletRegistry[pkgVersion] = true;
    }

    this._promiseMap = new Map();
    this._nextRequestId = 0;

    this._worklet = new AudioWorkletNode(audioContext, `ElementaryAudioWorkletProcessor@${pkgVersion}`, Object.assign({
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    }, workletOptions));

    return await new Promise<AudioWorkletNode>((resolve) => {
      this._worklet!.port.onmessage = (e) => {
        const [type, payload] = e.data as [string, unknown];

        if (type === "load") {
          this._renderer = new Renderer(async (batch: any) => {
            return await this._sendWorkletRequest("renderInstructions", { batch });
          });

          resolve(this._worklet!);
          return this.emit(type, payload);
        }

        if (type === "events") {
          return (payload as Array<{ type: string; event: unknown }>).forEach((event) => {
            this.emit(event.type, event.event);
          });
        }

        if (type === "reply") {
          const { requestId, result } = payload as { requestId: number; result: unknown };
          const pending = this._promiseMap!.get(requestId);

          this._promiseMap!.delete(requestId);
          pending?.resolve(result);
        }
      };

      this._timer = window.setInterval(() => {
        this._worklet!.port.postMessage({ requestType: "processQueuedEvents" });
      }, eventInterval);
    });
  }

  private _sendWorkletRequest(requestType: string, payload: unknown) {
    invariant(this._worklet, "Can't send request before worklet is ready. Have you initialized your WebRenderer instance?");

    const requestId = this._nextRequestId++;

    this._worklet.port.postMessage({
      requestId,
      requestType,
      payload,
    });

    return new Promise((resolve, reject) => {
      this._promiseMap!.set(requestId, { resolve, reject });
    });
  }

  async render(...args: unknown[]) {
    const { result, ...stats } = await this._renderer!.render(...args);

    if (!result.success) {
      return Promise.reject(result);
    }

    return Promise.resolve(stats);
  }
}
