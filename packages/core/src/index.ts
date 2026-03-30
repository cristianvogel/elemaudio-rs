import * as core from "./core";
import * as dynamics from "./dynamics";
import * as envelopes from "./envelopes";
import * as filters from "./filters";
import * as math from "./math";
import * as oscillators from "./oscillators";
import * as signals from "./signals";
import * as mc from "./mc";

export { createNode, isNode, resolve, unpack, Renderer } from "./vendor";
export type { NodeRepr_t } from "./vendor";

export const el = {
  ...core,
  ...dynamics,
  ...envelopes,
  ...filters,
  ...math,
  ...oscillators,
  ...signals,
  mc,
  "const": core.constant,
  "in": math.identity,
};

export default el;
