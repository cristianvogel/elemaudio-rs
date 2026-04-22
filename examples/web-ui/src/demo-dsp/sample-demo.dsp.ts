/**
 * Sample playback DSP graph — sample + freq shift + convolution with dry/wet.
 */

import type {NodeRepr_t} from "@elem-rs/core";
import {el} from "@elem-rs/core";

export interface SampleParams {
    samplePath: string;
    rate: number;
    blend: number;
    chopperThreshold: number;
    leftIrPath: string;
    rightIrPath: string;
    isStopped?: boolean;
}

export function buildGraph(p: SampleParams): NodeRepr_t[] {
    if (p.isStopped) {
        return [el.const({value: 0}), el.const({value: 0})];
    }
    const smRate = el.sm(el.const({key: "samp:rate", value: p.rate}));
    const trigger = el.train(el.mul(smRate, el.extra.sampleCount({unit: "hz", path: p.samplePath})));
    const blendNode = el.const({key: "fx:blend", value: p.blend});

    const sample = el.extra.sample({path: p.samplePath}, 0.0, 1.0, smRate, trigger);
    const leftSource = sample[0];
    const rightSource = sample[1];

    const chopperThreshold = el.const({key: "sample:chopper-threshold", value: p.chopperThreshold});

    function thresh(x: NodeRepr_t): NodeRepr_t {
        return el.extra.threshold({key: "threshold", hysteresis: 0.01, latch: true}, chopperThreshold, el.train(4), el.abs(x));
    }

    const ar = {
        atk: el.tau2pole(1.0e-4),
        rel: el.tau2pole(1/128)
    }

    const choppedLeft = el.mul( el.env( ar.atk, ar.rel,  thresh(leftSource)), el.add(leftSource));
    const choppedRight = el.mul( el.env( ar.atk, ar.rel,  thresh(leftSource)), el.add( rightSource));

    const shiftDown = el.extra.freqshift({shiftHz: 100, mix: 1.0, key: "fshift_Left", reflect: 3}, choppedLeft)[0];
    const shiftUp = el.extra.freqshift({shiftHz: 101, mix: 1.0, key: "fshift_Right", reflect: 3}, choppedRight)[0];
    const leftWet = el.convolve({key: "ir-left", path: p.leftIrPath}, el.mul(1.0e-3, shiftDown));
    const rightWet = el.convolve({key: "ir-right", path: p.rightIrPath}, el.mul(1.0e-3, shiftUp));

    return [
        el.mul(0.9, el.select(blendNode, leftWet, shiftDown)),
        el.mul(0.9, el.select(blendNode, rightWet, shiftUp))
    ];
}
