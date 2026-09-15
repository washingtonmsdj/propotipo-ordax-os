import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools" / "verify" / "native_graphics_prereqs.py"
SPEC = importlib.util.spec_from_file_location("ordax_native_graphics_prereqs", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class NativeGraphicsPrereqTests(unittest.TestCase):
    def test_current_kernel_fragment_keeps_graphics_and_input_substrate(self):
        self.assertEqual(MODULE.verify_fragment(MODULE.DEFAULT_FRAGMENT), [])

    def test_missing_generic_drm_path_fails(self):
        selectors = [
            *MODULE.REQUIRED_GRAPHICS,
            *MODULE.REQUIRED_INPUT,
            *MODULE.BASELINE_LAPTOP_PATHS,
        ]
        selectors.remove("CONFIG_DRM_SIMPLEDRM=y")
        with tempfile.TemporaryDirectory() as tmp:
            fragment = Path(tmp) / "fragment"
            fragment.write_text("\n".join(selectors) + "\n", encoding="utf-8")
            violations = MODULE.verify_fragment(fragment)
        self.assertTrue(any("CONFIG_DRM_SIMPLEDRM=y" in item for item in violations))

    def test_missing_evdev_path_fails(self):
        selectors = [
            *MODULE.REQUIRED_GRAPHICS,
            *MODULE.REQUIRED_INPUT,
            *MODULE.BASELINE_LAPTOP_PATHS,
        ]
        selectors.remove("CONFIG_INPUT_EVDEV=y")
        with tempfile.TemporaryDirectory() as tmp:
            fragment = Path(tmp) / "fragment"
            fragment.write_text("\n".join(selectors) + "\n", encoding="utf-8")
            violations = MODULE.verify_fragment(fragment)
        self.assertTrue(any("CONFIG_INPUT_EVDEV=y" in item for item in violations))

    def test_current_laptop_baseline_is_explicit_but_extensible(self):
        self.assertIn("CONFIG_DRM_I915=y", MODULE.BASELINE_LAPTOP_PATHS)
        self.assertNotIn("CONFIG_DRM_I915=y", MODULE.REQUIRED_GRAPHICS)
        self.assertIn("CONFIG_I2C_HID=y", MODULE.BASELINE_LAPTOP_PATHS)


if __name__ == "__main__":
    unittest.main()
