export const SURFACE_RENDER_LIFECYCLE_SCHEMA = "ordax.surface-render-lifecycle/3";

export function assertSurfaceRenderLifecycle(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schema !== SURFACE_RENDER_LIFECYCLE_SCHEMA ||
    typeof value.subscribeRender !== "function" ||
    typeof value.getAppTarget !== "function" ||
    typeof value.setAppTarget !== "function"
  ) {
    throw new TypeError("A compatible Surface render lifecycle with readable and writable app targets is required");
  }
  return value;
}
