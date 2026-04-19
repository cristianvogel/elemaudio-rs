//! End-to-end tests for the `frameScope` native node.

use elemaudio_rs::{Graph, Runtime, RuntimeEvent, el, extra};
use serde_json::{Value, json};

fn warm_past_root_fade(runtime: &Runtime, sample_rate: f64, buffer_size: usize) {
    let warm_samples = ((sample_rate * 0.040).ceil() as usize).max(buffer_size);
    let mut remaining = warm_samples;
    while remaining > 0 {
        let this_block = remaining.min(buffer_size);
        let mut buf = vec![0.0_f64; this_block];
        let mut outputs = [buf.as_mut_slice()];
        runtime
            .process(this_block, &[], &mut outputs)
            .expect("warm process");
        remaining -= this_block;
    }
}

fn build_runtime(sample_rate: f64, buffer_size: usize) -> Runtime {
    Runtime::new()
        .sample_rate(sample_rate)
        .buffer_size(buffer_size)
        .call()
        .expect("runtime")
}

fn latest_scope_event(events: &[RuntimeEvent]) -> &RuntimeEvent {
    events
        .iter()
        .rev()
        .find(|event| event.kind == "scope")
        .expect("scope event")
}

fn as_array<'a>(value: &'a Value, key: &str) -> &'a Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("missing array key {key}: {value}"))
}

fn as_number(value: &Value, key: &str) -> f64 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("missing number key {key}: {value}"))
}

#[test]
fn frame_scope_emits_exact_frame_length_scope_event() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_scope(
        json!({ "framelength": 4, "name": "frame-scope" }),
        [el::time()],
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; 8];
    let mut outputs = [block.as_mut_slice()];
    runtime.process(8, &[], &mut outputs).expect("process");

    let events = runtime.process_queued_events().expect("events");
    let event = latest_scope_event(&events);
    assert_eq!(event.event.get("source"), Some(&json!("frame-scope")));
    assert_eq!(as_number(&event.event, "frameLength"), 4.0);
    assert_eq!(as_number(&event.event, "frameStart"), 4.0);
    let channels = as_array(&event.event, "data");
    assert_eq!(channels.len(), 1);
    let samples = channels[0].as_array().expect("channel samples");
    let expected = [4.0, 5.0, 6.0, 7.0];
    for (sample, expected) in samples.iter().zip(expected) {
        assert_eq!(sample.as_f64(), Some(expected));
    }
}

#[test]
fn frame_scope_emits_exact_frame_length_across_uneven_blocks() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_scope(
        json!({ "framelength": 4, "name": "frame-scope" }),
        [el::time()],
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(2);

    for block_size in [3_usize, 2, 5] {
        let mut block = vec![0.0_f64; block_size];
        let mut outputs = [block.as_mut_slice()];
        runtime.process(block_size, &[], &mut outputs).expect("process");
    }

    let events = runtime.process_queued_events().expect("events");
    let event = latest_scope_event(&events);
    assert_eq!(as_number(&event.event, "frameLength"), 4.0);
    assert_eq!(as_number(&event.event, "frameStart"), 8.0);
    let channels = as_array(&event.event, "data");
    let samples = channels[0].as_array().expect("channel samples");
    let expected = [8.0, 9.0, 10.0, 11.0];
    for (sample, expected) in samples.iter().zip(expected) {
        assert_eq!(sample.as_f64(), Some(expected));
    }
}
