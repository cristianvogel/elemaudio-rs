fn main() {
    println!("cargo:rerun-if-changed=src/ffi/elementary_bridge.cpp");
    println!("cargo:rerun-if-changed=src/vendor/elementary/runtime");

    cc::Build::new()
        .cpp(true)
        .file("src/ffi/elementary_bridge.cpp")
        .include("src/vendor/elementary/runtime")
        .flag_if_supported("-std=c++17")
        .compile("elementary_bridge");
}
