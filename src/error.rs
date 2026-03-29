use std::ffi::NulError;
use std::fmt::{Display, Formatter};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum Error {
    NullHandle,
    InvalidArgument(&'static str),
    CString(NulError),
    Native {
        operation: &'static str,
        code: i32,
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
