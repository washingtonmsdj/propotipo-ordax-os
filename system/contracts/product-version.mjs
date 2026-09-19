export const PRODUCT_VERSION_SCHEMA = "ordax.product-version/1";

export const PRODUCT_VERSION = Object.freeze({
  schema: PRODUCT_VERSION_SCHEMA,
  semanticVersion: "0.1.0",
  displayVersion: "v0.1.0",
  displayName: "OrdaX Prototype v0.1.0",
  maturity: "prototype",
  stableRelease: false,
});

export function productVersionLabel() {
  return PRODUCT_VERSION.displayName;
}
