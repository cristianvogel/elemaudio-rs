import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";

export const FRAME_LENGTH = 256;
export const X_EVENT = "frame-domain:x";
export const Y_EVENT = "frame-domain:y";
export const PULSE_EVENT = "frame-domain:pulse";
export const FRAME_SCOPE_EVENT = "frame-domain:scope";

export interface FrameDomainDemoParams {
    offset: number;
    shift: number;
    tilt: number;
    scale: number;
    xIndex: number;
    yIndex: number;
    pulseIndex: number;
    isStopped?: boolean;
}

export function buildGraph(p: FrameDomainDemoParams): NodeRepr_t[] {
    if (p.isStopped) {
        return [el.const({value: 0}), el.const({value: 0})];
    }

    const offset = el.const({key: "fdp:offset", value: p.offset});
    const tilt = el.const({key: "fdp:tilt", value: p.tilt});
    const scale = el.const({key: "fdp:scale", value: p.scale});
    const shift = el.const({key: "fdp:shift", value: p.shift});

    const xIndex = el.const({key: "fdp:xIndex", value: p.xIndex});
    const yIndex = el.const({key: "fdp:yIndex", value: p.yIndex});
    const pulseIndex = el.const({key: "fdp:pulseIndex", value: p.pulseIndex});

    const framePhasor = el.extra.framePhasor(
        {key: "fdp:phasor", framelength: FRAME_LENGTH},
        offset,
        shift,
        tilt,
        scale,
    );

    const xReadout = el.extra.frameValue(
        {key: "fdp:xReadout", framelength: FRAME_LENGTH, name: X_EVENT},
        xIndex,
        framePhasor,
    );
    const yReadout = el.extra.frameValue(
        {key: "fdp:yReadout", framelength: FRAME_LENGTH, name: Y_EVENT},
        yIndex,
        framePhasor,
    );
    const pulseReadout = el.extra.frameValue(
        {key: "fdp:pulseReadout", framelength: FRAME_LENGTH, name: PULSE_EVENT},
        pulseIndex,
        framePhasor,
    );
    const frameScope = el.extra.frameScope(
        {key: "fdp:scope", framelength: FRAME_LENGTH, name: FRAME_SCOPE_EVENT},
        framePhasor,
    );

    // Route event-producing nodes through the audio graph roots so the runtime
    // actually schedules them. frameValue/frameScope pass their input through
    // unchanged, so the audible signal needs to stay silent without being pruned.
    // Wrap it in el.add( 0, ... ) to ensure the graph renders
    const kept = el.add(
       0,
        el.mul(0, xReadout, yReadout, pulseReadout, frameScope,  shift),
    );
    return [kept, el.const({value: 0})];
}
