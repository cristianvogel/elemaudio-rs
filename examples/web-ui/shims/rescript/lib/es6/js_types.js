export function classify(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  switch (typeof value) {
    case "string":
      return { TAG: 1, _0: value };
    case "number":
      return { TAG: 0, _0: value };
    case "boolean":
      return { TAG: 2, _0: value };
    default:
      return { TAG: 3, _0: value };
  }
}

export function test(value, kind) {
  switch (kind) {
    case 0:
      return typeof value === "number";
    case 1:
      return typeof value === "string";
    case 2:
      return typeof value === "boolean";
    case 3:
      return typeof value === "object" && value !== null;
    case 4:
      return typeof value === "string";
    default:
      return false;
  }
}
