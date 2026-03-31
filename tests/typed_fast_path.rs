use elemaudio_rs::{el, Graph};

#[test]
fn mounted_graph_exposes_direct_update_handle() {
    let graph = Graph::new().root(el::const_(220.0));

    let mounted = graph.mount();
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
        .root(el::cycle(el::sm(el::const_(220.0))))
        .root(el::cycle(el::sm(el::const_(330.0))));

    let lowered = graph.lower().to_json_string();
    let mounted = graph.mount().batch().to_json_string();

    assert_eq!(mounted, lowered);
}

#[test]
fn mounted_graph_can_find_nested_nodes_by_path() {
    let graph = Graph::new().root(el::add([el::const_(1.0), el::sin(el::const_(2.0))]));

    let mounted = graph.mount();

    let root = mounted.node_at(&[0]).expect("mounted root node");
    let left = mounted.node_at(&[0, 0]).expect("left child node");
    let nested = mounted.node_at(&[0, 1, 0]).expect("nested child node");

    assert_eq!(root.kind(), "add");
    assert_eq!(left.kind(), "const");
    assert_eq!(left.id(), 3);
    assert_eq!(nested.kind(), "const");
    assert_eq!(nested.id(), 5);
}
