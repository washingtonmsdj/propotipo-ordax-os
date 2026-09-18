import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "system" / "contracts" / "file-space.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "file-space.mjs"
NATIVE_RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
APP_ACTIVATION_CONTRACT = ROOT / "system" / "contracts" / "app-activation.mjs"
APP_ACTIVATION_SERVICE = ROOT / "system" / "services" / "apps" / "activation.mjs"
DESKTOP_SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
SURFACE_LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
FILES_APP = ROOT / "system" / "apps" / "files" / "app.mjs"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"

spec = importlib.util.spec_from_file_location("ordax_native_host_files_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeUserFilesTests(unittest.TestCase):
    def test_file_space_contract_and_native_adapter_are_narrow(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('ordax.file-space/1', contract)
        self.assertIn("list() and createDirectory()", contract)
        self.assertIn('/__ordax/native/files', adapter)
        self.assertIn("validateFileListing", adapter)
        self.assertNotIn("surface/ui", adapter)
        self.assertNotIn("innerHTML", adapter)

    def test_native_file_root_lists_and_creates_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "notes.txt").write_text("ordax", encoding="utf-8")

            listing = native_host.list_user_directory(str(user_root), "/")
            self.assertEqual(listing["path"], "/")
            self.assertIn(
                {"name": "notes.txt", "kind": "file", "size": 5},
                listing["entries"],
            )

            created = native_host.create_user_directory(str(user_root), "/", "Documentos")
            self.assertTrue((user_root / "Documentos").is_dir())
            self.assertIn(
                {"name": "Documentos", "kind": "directory", "size": 0},
                created["entries"],
            )

    def test_standard_user_directories_are_idempotent_and_symlink_safe(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()
            os.symlink(outside, user_root / "Documentos")

            first = native_host.ensure_standard_user_directories(str(user_root))
            second = native_host.ensure_standard_user_directories(str(user_root))

            self.assertNotIn("Documentos", first)
            self.assertNotIn("Documentos", second)
            self.assertIn("Imagens", first)
            self.assertIn("Downloads", first)
            self.assertTrue((user_root / "Imagens").is_dir())
            self.assertTrue((user_root / "Downloads").is_dir())
            self.assertEqual(list(outside.iterdir()), [])

    def test_path_traversal_and_symlink_escape_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()
            (outside / "secret.txt").write_text("blocked", encoding="utf-8")
            os.symlink(outside, user_root / "escape")

            with self.assertRaises(ValueError):
                native_host.list_user_directory(str(user_root), "/../outside")
            with self.assertRaises(ValueError):
                native_host.create_user_directory(str(user_root), "/", "../outside")
            with self.assertRaises(OSError):
                native_host.list_user_directory(str(user_root), "/escape")

            root_listing = native_host.list_user_directory(str(user_root), "/")
            self.assertNotIn("escape", {entry["name"] for entry in root_listing["entries"]})

    def test_native_runtime_keeps_user_data_separate_from_device_state(self):
        launcher = SURFACE_LAUNCHER.read_text(encoding="utf-8")
        self.assertIn('PERSISTENT_NATIVE_STATE=$STATE_ROOT/native-state', launcher)
        self.assertIn('PERSISTENT_USER_HOME=$STATE_ROOT/home', launcher)
        self.assertIn('$RUNTIME_ROOT/var/lib/ordax-user', launcher)
        self.assertIn('--user-root /var/lib/ordax-user', launcher)
        self.assertIn('mount -o bind "$PERSISTENT_USER_HOME"', launcher)
        self.assertIn('umount "$RUNTIME_ROOT/var/lib/ordax-user"', launcher)

    def test_shared_files_controls_consume_only_neutral_port(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        activation_contract = APP_ACTIVATION_CONTRACT.read_text(encoding="utf-8")
        activation_service = APP_ACTIVATION_SERVICE.read_text(encoding="utf-8")
        shell = DESKTOP_SHELL.read_text(encoding="utf-8")
        self.assertIn("contracts/file-space.mjs", controls)
        self.assertIn("contracts/app-activation.mjs", controls)
        self.assertIn('ordax.app-activation/1', activation_contract)
        self.assertIn("createAppActivationChannel", activation_service)
        self.assertIn('data-app-target="${target}"', shell)
        self.assertIn('data-requires-capability="filesystem.user-space"', shell)
        self.assertIn('[data-window-id="files"]', controls)
        self.assertIn("createDirectory", controls)
        self.assertIn("./surface-lifecycle.mjs", controls)
        self.assertIn("assertSurfaceRenderLifecycle", controls)
        self.assertNotIn("MutationObserver", controls)
        self.assertNotIn("adapters/native", controls)
        self.assertNotIn("/__ordax/native/", controls)
        self.assertIn("createNativeFileSpace", composition)
        self.assertIn("mountFileSpaceControls(root, fileSpace, appActivation, surface)", composition)
        self.assertIn("createAppActivationChannel", composition)
        self.assertIn("appActivation", composition)
        self.assertIn("userFileSpaceAvailable", composition)

    def test_user_file_space_capability_is_additive_and_native(self):
        contract = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        capabilities = {entry["id"]: entry for entry in contract["capabilities"]}
        self.assertEqual(
            capabilities["filesystem.user-space"]["security_boundary"],
            "bounded-user-root",
        )
        modes = {mode["id"]: mode for mode in contract["modes"]}
        self.assertIn("filesystem.user-space", modes["usb"]["baseline_capabilities"])
        self.assertIn("filesystem.user-space", modes["native-disk"]["baseline_capabilities"])
        self.assertNotIn("filesystem.user-space", modes["web"]["baseline_capabilities"])

        runtime = NATIVE_RUNTIME.read_text(encoding="utf-8")
        files_app = FILES_APP.read_text(encoding="utf-8")
        self.assertIn('"filesystem.user-space"', runtime)
        self.assertIn("userFileSpaceAvailable", runtime)
        self.assertIn('capabilityId: "filesystem.user-space"', files_app)


if __name__ == "__main__":
    unittest.main()
