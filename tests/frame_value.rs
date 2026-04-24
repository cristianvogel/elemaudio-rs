//! End-to-end tests for the `frameValue` native node and queued event bridge.

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

fn read_number(value: &Value, key: &str) -> f64 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("missing numeric key {key}: {value}"))
}

fn latest_frame_value_event(events: &[RuntimeEvent]) -> &RuntimeEvent {
    events
        .iter()
        .rev()
        .find(|event| event.kind == "frameValue")
        .expect("frameValue event")
}

#[test]
fn frame_value_emits_selected_sample_once_per_frame() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let graph = Graph::new().render(extra::frame_value(
        json!({ "framelength": 8, "name": "fv" }),
        2.0,
        el::time(),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; 16];
    let mut outputs = [block.as_mut_slice()];
    runtime.process(16, &[], &mut outputs).expect("process");

    let events = runtime.process_queued_events().expect("events");
    let event = latest_frame_value_event(&events);

    assert_eq!(event.event.get("source"), Some(&json!("fv")));
    assert_eq!(read_number(&event.event, "data"), 10.0);
    assert_eq!(read_number(&event.event, "index"), 2.0);
    assert_eq!(read_number(&event.event, "frameStart"), 8.0);
}

#[test]
fn frame_value_latches_index_only_on_frame_boundaries() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let index = el::select(el::ge(el::time(), 2.0), 5.0, 2.0);
    let graph = Graph::new().render(extra::frame_value(
        json!({ "framelength": 8, "name": "fv" }),
        index,
        el::time(),
    ));
    let mounted = graph.mount().expect("mount");
    runtime.apply_instructions(mounted.batch()).expect("apply");

    warm_past_root_fade(&runtime, sample_rate, buffer_size);
    runtime.reset();
    runtime.set_current_time_samples(0);

    let mut block = vec![0.0_f64; 8];
    let mut outputs = [block.as_mut_slice()];
    runtime
        .process(8, &[], &mut outputs)
        .expect("process first");
    let first_events = runtime.process_queued_events().expect("first events");
    let first = latest_frame_value_event(&first_events);
    assert_eq!(read_number(&first.event, "data"), 2.0);
    assert_eq!(read_number(&first.event, "index"), 2.0);
    assert_eq!(read_number(&first.event, "frameStart"), 0.0);

    runtime
        .process(8, &[], &mut outputs)
        .expect("process second");
    let second_events = runtime.process_queued_events().expect("second events");
    let second = latest_frame_value_event(&second_events);
    assert_eq!(read_number(&second.event, "data"), 13.0);
    assert_eq!(read_number(&second.event, "index"), 5.0);
    assert_eq!(read_number(&second.event, "frameStart"), 8.0);
}

#[test]
fn queued_event_bridge_returns_empty_when_no_events_are_pending() {
    let sample_rate = 48_000.0;
    let buffer_size = 64;
    let runtime = build_runtime(sample_rate, buffer_size);

    let events = runtime.process_queued_events().expect("events");
    assert!(events.is_empty());
}
