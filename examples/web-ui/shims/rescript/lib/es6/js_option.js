export function getExn(value) {
  if (value === undefined || value === null) {
    throw new Error("Option.getExn: value is empty");
  }

  return value;
}
