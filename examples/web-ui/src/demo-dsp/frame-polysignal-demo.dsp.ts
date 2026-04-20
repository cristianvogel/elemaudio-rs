import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";
import {FRAME_LENGTH} from "./frame-domain-demo.dsp";

export {FRAME_LENGTH};

export const FRAME_SCOPE_EVENT = "frame-polysignal:scope";

export interface FramePolySignalDemoParams {
    rate: number;
    phaseSpread: number;
    rateSpread: number;
    resetCounter: number;
    isStopped?: boolean;
}

export function buildGraph(p: FramePolySignalDemoParams): NodeRepr_t[] {
    if (p.isStopped) {
        return [el.const({value: 0}), el.const({value: 0})];
    }

    const poly = el.extra.framePolySignal(
        {
            key: "fps:poly",
            framelength: FRAME_LENGTH,
            bpm: p.rate,
            // omit the path and an internal sine wave will be used
            path: "fps:multi_lfo",
            resetcounter: p.resetCounter
        },
        el.const({key: "fps:phaseSpread", value: p.phaseSpread}), // internally, the biasing shape is a [-1..1] ramp
        el.const({key: "fps:rateSpread", value: p.rateSpread}),
        0
    );

    const writer = el.extra.frameWriteRAM({
        key: "fps:writer",
        framelength: FRAME_LENGTH,
        path: "fps:wtOscFromPoly"
    }, poly)


    const frameScope = el.extra.frameScope(
        {key: "fps:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT},
        writer
    );

    // here we read one table with an reverse phasor and hard pan the voices for proper binaural beats
    const oscPair = [
        el.table({key: 'fps:ll', path: 'fps:wtOscFromPoly'}, el.phasor(80)),
        el.table({key: 'fps:rr', path: 'fps:wtOscFromPoly'}, el.phasor(-80))
    ];


    const left =  el.dcblock( el.mul(el.db2gain(-30), oscPair[0]));
    const right = el.dcblock( el.mul(el.db2gain(-30), oscPair[1]));
    return [ el.add(  el.mul(0, frameScope) ,left), right];
}
