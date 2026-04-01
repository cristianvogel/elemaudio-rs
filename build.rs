fn main() {
    println!("cargo:rerun-if-changed=src/ffi/elementary_bridge.cpp");
    println!("cargo:rerun-if-changed=src/vendor/elementary/runtime");
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_RESOURCES");

    let mut build = cc::Build::new();
    build
        .cpp(true)
        .file("src/ffi/elementary_bridge.cpp")
        .include("src/vendor/elementary/runtime")
        .flag_if_supported("-std=c++17");

    if std::env::var_os("CARGO_FEATURE_RESOURCES").is_some() {
        build.define("ELEM_RS_ENABLE_RESOURCES", None);
    }

    build.compile("elementary_bridge");
}
