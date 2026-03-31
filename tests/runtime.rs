use elemaudio_rs::{Instruction, InstructionBatch};

#[test]
fn instruction_batch_serializes_to_runtime_shape() {
    let mut batch = InstructionBatch::new();
    batch.push(Instruction::CreateNode {
        node_id: 7,
        node_type: "osc".into(),
    });
    batch.push(Instruction::SetProperty {
        node_id: 7,
        property: "gain".into(),
        value: serde_json::json!(0.5),
    });
    batch.push(Instruction::CommitUpdates);

    assert_eq!(
        batch.to_json_string(),
        r#"[[0,7,"osc"],[3,7,"gain",0.5],[5]]"#
    );
}
