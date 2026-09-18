export const SURFACE_RENDER_LIFECYCLE_SCHEMA = "ordax.surface-render-lifecycle/1";

export function assertSurfaceRenderLifecycle(value) {
  if (
    !value ||
    typeof value !== "object" ||
    value.schema !== SURFACE_RENDER_LIFECYCLE_SCHEMA ||
    typeof value.subscribeRender !== "function"
  ) {
    throw new TypeError("A compatible Surface render lifecycle is required");
  }
  return value;
}
