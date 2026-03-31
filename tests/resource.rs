use elemaudio_rs::{AudioBuffer, Resource, ResourceManager};

#[test]
fn add_replace_remove_and_rename_work() {
    let mut manager = ResourceManager::new();

    manager
        .add("buffer", Resource::f32([1.0, 2.0, 3.0]))
        .unwrap();
    assert!(manager.contains("buffer"));

    manager.rename("buffer", "buffer-main").unwrap();
    assert!(manager.get("buffer").is_none());
    assert_eq!(manager.get("buffer-main").unwrap().kind(), "f32");

    let previous = manager
        .replace("buffer-main", Resource::text("hello"))
        .unwrap();
    assert_eq!(previous.kind(), "f32");
    assert_eq!(manager.get("buffer-main").unwrap().kind(), "text");

    let removed = manager.remove("buffer-main").unwrap();
    assert_eq!(removed.kind(), "text");
    assert!(manager.is_empty());
}

#[test]
fn custom_resources_downcast() {
    #[derive(Debug, PartialEq)]
    struct RingBuffer(usize);

    let resource = Resource::custom(RingBuffer(128));
    let downcast = resource.downcast::<RingBuffer>().unwrap();

    assert_eq!(downcast.as_ref().0, 128);
}

#[test]
fn audio_resources_report_kind() {
    let buffer = AudioBuffer::mono([0.0, 1.0], 44100);
    let resource = Resource::audio(buffer);

    assert_eq!(resource.kind(), "audio");
    assert_eq!(resource.as_audio().unwrap().frames(), 2);
}

#[test]
fn prune_except_removes_unkept_resources() {
    let mut manager = ResourceManager::new();

    manager.add("keep", Resource::text("a")).unwrap();
    manager.add("drop", Resource::text("b")).unwrap();

    let pruned = manager.prune_except(["keep"]);

    assert_eq!(pruned.len(), 1);
    assert!(manager.contains("keep"));
    assert!(!manager.contains("drop"));
}
