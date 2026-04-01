use elemaudio_rs::{el, Graph, Result, Runtime};

fn main() -> Result<()> {
    let runtime = Runtime::new()
        .sample_rate(48_000.0)
        .buffer_size(128)
        .call()?;

    let graph = Graph::new().render(el::cycle(el::const_(220.0)));
    runtime.apply_instructions(&graph.lower())?;

    let mut output = vec![0.0_f64; 128];
    let mut outputs = [&mut output[..]];
    runtime.process(128, &[], &mut outputs)?;

    println!("first samples: {:?}", &output[..8]);
    Ok(())
}
