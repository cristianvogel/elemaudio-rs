use elemaudio_rs::{el, Graph, Runtime};

#[test]
fn mounted_graph_exposes_direct_update_handle() {
    let graph = Graph::new().render(el::const_(220.0));

    let mounted = graph.mount().expect("mount");
    let root = mounted.node_at(&[0]).expect("mounted root node");

    assert_eq!(root.kind(), "const");
    assert_eq!(root.id(), 2);
    assert_eq!(mounted.roots()[0].id(), 2);

    let update = root.set_property("value", serde_json::json!(330.0));
    assert_eq!(update.to_json_string(), r#"[[3,2,"value",330.0],[5]]"#);
}

#[test]
fn mounted_graph_batch_matches_lowered_graph() {
    let graph = Graph::new()
        .render(el::cycle(el::sm(el::const_(220.0))))
        .render(el::cycle(el::sm(el::const_(330.0))));

    let lowered = graph.lower().to_json_string();
    let mounted = graph.mount().expect("mount").batch().to_json_string();

    assert_eq!(mounted, lowered);
}

#[test]
fn mounted_graph_can_find_nested_nodes_by_path() {
    let graph = Graph::new().render(el::add((el::const_(1.0), el::sin(el::const_(2.0)))));

    let mounted = graph.mount().expect("mount");

    let root = mounted.node_at(&[0]).expect("mounted root node");
    let left = mounted.node_at(&[0, 0]).expect("left child node");
    let nested = mounted.node_at(&[0, 1, 0]).expect("nested child node");

    assert_eq!(root.kind(), "add");
    assert_eq!(left.kind(), "const");
    assert_eq!(left.id(), 3);
    assert_eq!(nested.kind(), "const");
    assert_eq!(nested.id(), 5);
}

#[test]
fn mounted_node_updates_audio_without_remounting() {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(64)
        .call()
        .expect("runtime should construct");

    let graph = Graph::new().render(el::cycle(el::const_with_key("freq", 220.0)));
    let mounted = graph.mount().expect("mount");
    let frequency = mounted
        .node_with_key("freq")
        .expect("mounted frequency node");

    assert_eq!(frequency.kind(), "const");
    assert_eq!(frequency.key(), Some("freq"));
    assert_eq!(
        mounted
            .set_const_value("freq", 440.0)
            .expect("keyed const should update")
            .to_json_string(),
        format!(r#"[[3,{},"value",440.0],[5]]"#, frequency.id())
    );

    runtime
        .apply_instructions(mounted.batch())
        .expect("initial mount should apply");

    let mut before = vec![0.0_f64; 64];
    let mut before_outputs = [&mut before[..]];
    runtime
        .process(64, &[], &mut before_outputs)
        .expect("should render initial block");

    runtime
        .apply_instructions(
            &mounted
                .set_const_value("freq", 440.0)
                .expect("keyed const should update"),
        )
        .expect("fast-path update should apply");

    let mut after = vec![0.0_f64; 64];
    let mut after_outputs = [&mut after[..]];
    runtime
        .process(64, &[], &mut after_outputs)
        .expect("should render updated block");

    assert_ne!(before, after);
    assert_ne!(before[0], after[0]);
}
