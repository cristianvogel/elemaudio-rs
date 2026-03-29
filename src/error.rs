//! Error types and native return-code mapping for the runtime wrapper.

use std::ffi::NulError;
use std::fmt::{Display, Formatter};

/// Result type used by the public API.
pub type Result<T> = std::result::Result<T, Error>;

/// Errors returned by the safe wrapper.
#[derive(Debug)]
pub enum Error {
    /// The native runtime returned a null handle during construction.
    NullHandle,
    /// A wrapper-side argument validation failure.
    InvalidArgument(&'static str),
    /// A string contained an interior nul byte before crossing the FFI boundary.
    CString(NulError),
    /// A native operation returned a non-zero status code.
    Native {
        /// The operation that failed.
        operation: &'static str,
        /// The raw native status code.
        code: i32,
        /// Human-readable description of the status code.
        message: String,
    },
}

impl Display for Error {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NullHandle => write!(f, "native runtime handle was null"),
            Self::InvalidArgument(message) => write!(f, "invalid argument: {message}"),
            Self::CString(err) => write!(f, "string contains interior nul byte: {err}"),
            Self::Native {
                operation,
                code,
                message,
            } => {
                write!(f, "{operation} failed with code {code}: {message}")
            }
        }
    }
}

impl std::error::Error for Error {}

impl From<NulError> for Error {
    fn from(value: NulError) -> Self {
        Self::CString(value)
    }
}

/// Describes a native runtime return code.
///
/// The mapping is used when the native bridge reports a failure code and the
/// wrapper needs to surface a human-readable message.
pub fn describe_return_code(code: i32) -> &'static str {
    match code {
        0 => "Ok",
        1 => "Node type not recognized",
        2 => "Node not found",
        3 => "Attempting to create a node that already exists",
        4 => "Attempting to create a node type that already exists",
        5 => "Invalid value type for the given node property",
        6 => "Invalid value for the given node property",
        7 => "Invariant violation",
        8 => "Invalid instruction format",
        _ => "Return code not recognized",
    }
}
