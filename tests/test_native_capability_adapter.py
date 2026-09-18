from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE_RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
NATIVE_COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_RUNTIME = ROOT / "system" / "adapters" / "web" / "runtime.mjs"


class NativeCapabilityAdapterTests(unittest.TestCase):
    def test_native_runtime_owns_native_surface_snapshot(self):
        text = NATIVE_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("createNativeSurfaceHost", text)
        self.assertIn('"surface.render"', text)
        self.assertIn('"network.https"', text)
        self.assertIn('"system.boot-control"', text)
        self.assertIn('"filesystem.user-space"', text)
        self.assertIn('"system.metrics"', text)
        self.assertIn('"power.status"', text)
        self.assertIn('"network.status"', text)
        self.assertIn("bootControlAvailable", text)
        self.assertIn("userFileSpaceAvailable", text)
        self.assertIn("systemMetricsAvailable", text)
        self.assertIn("powerStatusAvailable", text)
        self.assertIn("networkStatusAvailable", text)
        self.assertIn("validateSurfaceSnapshot", text)
        self.assertIn("navigator.onLine", text)

    def test_native_composition_does_not_reuse_web_host_adapter(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('../../adapters/native/runtime.mjs', text)
        self.assertIn("createNativeSurfaceHost", text)
        self.assertNotIn('../../adapters/web/runtime.mjs', text)
        self.assertNotIn("createWebSurfaceHost", text)

    def test_native_optional_capabilities_are_derived_from_actual_ports(self):
        text = NATIVE_COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("powerActions?.getSnapshot().supportedActions.length", text)
        self.assertIn("userFileSpaceAvailable = fileSpace !== null", text)
        self.assertIn("systemMetricsAvailable = systemMetrics !== null", text)
        self.assertIn("powerStatusAvailable = powerStatus !== null", text)
        self.assertIn("networkStatusAvailable = networkStatus !== null", text)
        self.assertIn("bootControlAvailable,", text)
        self.assertIn("userFileSpaceAvailable,", text)
        self.assertIn("systemMetricsAvailable,", text)
        self.assertIn("powerStatusAvailable,", text)
        self.assertIn("networkStatusAvailable,", text)
        self.assertIn("createNativeSurfaceHost(window, {", text)

    def test_native_adapter_does_not_claim_unimplemented_account_or_sync(self):
        text = NATIVE_RUNTIME.read_text(encoding="utf-8")
        self.assertNotIn('"account.identity"', text)
        self.assertNotIn('"sync.safe-state"', text)
        self.assertNotIn('"system.release-activation"', text)
        self.assertNotIn('"system.recovery"', text)

    def test_web_adapter_remains_independent(self):
        text = WEB_RUNTIME.read_text(encoding="utf-8")
        self.assertIn("createWebSurfaceHost", text)
        self.assertNotIn("system.boot-control", text)
        self.assertNotIn("filesystem.user-space", text)
        self.assertNotIn("system.metrics", text)
        self.assertNotIn("network.status", text)


if __name__ == "__main__":
    unittest.main()
