fn main() {
    if std::env::var_os("ELEM_AUDIO_DOCS_ONLY").is_some() {
        return;
    }

    let manifest_dir =
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set by Cargo");
    let vendor_runtime = format!("{manifest_dir}/src/vendor/elementary/runtime");
    let vendor_third_party =
        format!("{manifest_dir}/src/vendor/elementary/runtime/elem/third-party");
    let vendor_fft_convolver = format!("{manifest_dir}/src/vendor/elementary/wasm/FFTConvolver");
    let native_runtime = format!("{manifest_dir}/src/native");

    println!("cargo:rerun-if-changed=src/ffi/elementary_bridge.cpp");
    println!("cargo:rerun-if-changed=src/vendor/elementary/runtime");
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_RESOURCES");

    let mut build = cc::Build::new();
    build
        .cpp(true)
        .file("src/ffi/elementary_bridge.cpp")
        .file(format!("{vendor_fft_convolver}/AudioFFT.cpp"))
        .include(&vendor_runtime)
        .include(&vendor_third_party)
        .include(&vendor_fft_convolver)
        .include(&native_runtime)
        .flag_if_supported("-w") // stop vendor/bridge compilation emitting tonnes of warning spam
        .flag_if_supported("-std=c++17");

    if std::env::var_os("CARGO_FEATURE_RESOURCES").is_some() {
        build.define("ELEM_RS_ENABLE_RESOURCES", None);
    }

    build.compile("elementary_bridge");
}
