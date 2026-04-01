use proc_macro::TokenStream;
use quote::quote;
use syn::{
    parse_macro_input, spanned::Spanned, Expr, ExprCall, ExprGroup, ExprLit, ExprMacro, ExprParen,
    ExprPath, Ident,
};

#[proc_macro]
pub fn el(input: TokenStream) -> TokenStream {
    let expr = parse_macro_input!(input as Expr);
    expand_expr(&expr).into()
}

fn expand_expr(expr: &Expr) -> proc_macro2::TokenStream {
    match expr {
        Expr::Call(call) => expand_call(call),
        Expr::Paren(ExprParen { expr, .. }) | Expr::Group(ExprGroup { expr, .. }) => {
            expand_expr(expr)
        }
        Expr::Macro(ExprMacro { mac, .. }) => quote!(#mac),
        Expr::Path(ExprPath { path, .. }) => quote!(#path),
        Expr::Lit(ExprLit { lit, .. }) => quote!(#lit),
        Expr::Unary(unary) => {
            let inner = expand_expr(&unary.expr);
            let op = &unary.op;
            quote!(#op #inner)
        }
        Expr::Binary(binary) => {
            let left = expand_expr(&binary.left);
            let right = expand_expr(&binary.right);
            let op = &binary.op;
            quote!((#left #op #right))
        }
        Expr::Array(array) => {
            let elems = array.elems.iter().map(expand_expr);
            quote!([#(#elems),*])
        }
        _ => quote!(#expr),
    }
}

fn expand_call(call: &ExprCall) -> proc_macro2::TokenStream {
    let ident = match call.func.as_ref() {
        Expr::Path(ExprPath { path, .. }) if path.segments.len() == 1 => {
            path.segments[0].ident.clone()
        }
        _ => return quote!(#call),
    };

    let args: Vec<_> = call.args.iter().map(expand_expr).collect();
    let name = ident.to_string();

    match name.as_str() {
        "const" | "const_" | "r#const" => {
            if args.len() != 1 {
                return syn::Error::new_spanned(call, "const expects one argument")
                    .to_compile_error();
            }
            let value = &args[0];
            quote!(::elemaudio_rs::el::const_(#value))
        }
        "mod" | "r#mod" => binary_call("mod", &args, call),
        "min" => binary_call("min", &args, call),
        "max" => binary_call("max", &args, call),
        "add" | "sub" | "mul" | "div" => variadic_call(&name, &args, call),
        "rand" | "metro" | "noise" | "pinknoise" => optional_props_call(&name, &args, call),
        "sphasor" => {
            if args.len() != 2 {
                return syn::Error::new_spanned(call, "sphasor expects two arguments")
                    .to_compile_error();
            }
            let left = &args[0];
            let right = &args[1];
            quote!(::elemaudio_rs::el::syncphasor(#left, #right))
        }
        _ => {
            let path = make_el_path(&ident);
            quote!(#path(#(#args),*))
        }
    }
}

fn make_el_path(ident: &Ident) -> proc_macro2::TokenStream {
    let name = ident.to_string();
    let mapped = match name.as_str() {
        "const" | "const_" | "r#const" => "const_",
        "mod" | "r#mod" => "r#mod",
        "sphasor" => "syncphasor",
        _ => name.as_str(),
    };

    let ident = syn::Ident::new(mapped, ident.span());
    quote!(::elemaudio_rs::el::#ident)
}

fn binary_call(
    name: &str,
    args: &[proc_macro2::TokenStream],
    call: &ExprCall,
) -> proc_macro2::TokenStream {
    if args.len() != 2 {
        return syn::Error::new_spanned(call, format!("{} expects two arguments", name))
            .to_compile_error();
    }
    let left = &args[0];
    let right = &args[1];
    let ident = if name == "mod" || name == "r#mod" {
        syn::Ident::new_raw("mod", call.span())
    } else {
        syn::Ident::new(name, call.span())
    };
    quote!(::elemaudio_rs::el::#ident(#left, #right))
}

fn variadic_call(
    name: &str,
    args: &[proc_macro2::TokenStream],
    call: &ExprCall,
) -> proc_macro2::TokenStream {
    if args.is_empty() {
        return syn::Error::new_spanned(call, format!("{} expects at least one argument", name))
            .to_compile_error();
    }
    let name_lit = syn::LitStr::new(name, call.span());
    quote!(::elemaudio_rs::create_node(
        #name_lit,
        ::serde_json::Value::Null,
        vec![#(::elemaudio_rs::ElemNode::from(#args)),*],
    ))
}

fn optional_props_call(
    name: &str,
    args: &[proc_macro2::TokenStream],
    call: &ExprCall,
) -> proc_macro2::TokenStream {
    let ident = syn::Ident::new(name, call.span());
    match args.len() {
        0 => quote!(::elemaudio_rs::el::#ident(None)),
        1 => {
            let props = &args[0];
            quote!(::elemaudio_rs::el::#ident(Some(#props)))
        }
        _ => syn::Error::new_spanned(call, format!("{} expects zero or one argument", name))
            .to_compile_error(),
    }
}
