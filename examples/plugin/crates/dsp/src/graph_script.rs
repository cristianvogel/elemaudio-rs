//! Stereo stride delay graph script.
//!
//! Pure `el::*` graph authoring — no plumbing. The engine auto-discovers
//! keyed consts and native props from the graph tree.

use crate::{DspParameters, MAX_DELAY_MS};
use elemaudio_rs::engine::DspGraph;
use elemaudio_rs::graph::Node;
use elemaudio_rs::{el, extra};
use serde_json::json;

/// Stereo stride delay graph.
///
/// ```text
/// const_with_key("sd:L:delay") ──┐
/// const_with_key("sd:L:fb") ─────┤
/// in(ch=0) ──────────────────────┘──► stridedelay ──► wet ─┐
///                                                           ├── add ──► root[0]
/// in(ch=0) ─────────────────────────────────────► dry ─────┘
/// ```
pub struct StrideDelayGraph;

impl DspGraph for StrideDelayGraph {
    type Params = DspParameters;

    fn build(p: &DspParameters) -> Vec<Node> {
        let channel = |ch: usize, tag: &str| {
            let input = el::r#in(json!({"channel": ch}), None);
            let delay = el::const_with_key(&format!("sd:{tag}:delay"), p.delay_ms as f64);
            let fb = el::const_with_key(&format!("sd:{tag}:fb"), p.feedback as f64);

            let delayed = extra::stride_delay(
                json!({
                    "maxDelayMs": MAX_DELAY_MS,
                    "transitionMs": p.transition_ms as f64,
                    "bigLeapMode": "step",
                }),
                delay,
                fb,
                input.clone(),
            );

            // Manual wet/dry blend — el::select clones the gate node
            // which causes duplicate key panics in mount().
            let mix_wet = el::const_with_key(&format!("sd:{tag}:mix"), p.mix as f64);
            let mix_dry = el::const_with_key(&format!("sd:{tag}:mix_dry"), p.mix as f64);
            let wet = el::mul((delayed, mix_wet));
            let dry = el::mul((input, el::sub((1.0, mix_dry))));
            el::add((wet, dry))
        };

        vec![channel(0, "L"), channel(1, "R")]
    }
}
