from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import os
import stat
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOST_SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
COMMIT = "0123456789abcdef0123456789abcdef01234567"
OTHER_COMMIT = "abcdef0123456789abcdef0123456789abcdef01"


def load_host_server():
    spec = spec_from_file_location("ordax_native_component_slot_test", HOST_SERVER)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def make_slot(root: Path, *, commit: str = COMMIT, writable_file: bool = False) -> Path:
    runtime_dir = (
        root
        / "internet"
        / "versions"
        / "0.4.0"
        / commit
        / "system"
        / "components"
        / "internet"
    )
    runtime_dir.mkdir(parents=True)
    runtime_path = runtime_dir / "runtime.mjs"
    runtime_path.write_text(
        'export const componentRuntime = { version: "0.4.0" };\n',
        encoding="utf-8",
    )
    css_path = runtime_dir / "internet.css"
    css_path.write_text(".internet { display: block; }\n", encoding="utf-8")

    runtime_path.chmod(0o644 if writable_file else 0o444)
    css_path.chmod(0o444)

    immutable_root = root / "internet" / "versions" / "0.4.0" / commit
    for directory, subdirs, _files in os.walk(immutable_root, topdown=False):
        Path(directory).chmod(0o555)
        for subdir in subdirs:
            (Path(directory) / subdir).chmod(0o555)
    immutable_root.chmod(0o555)
    return runtime_path


def allow_cleanup(root: Path) -> None:
    if os.name == "nt":
        return
    for directory, subdirs, files in os.walk(root, topdown=False):
        for name in files:
            try:
                (Path(directory) / name).chmod(0o600)
            except OSError:
                pass
        for name in subdirs:
            try:
                (Path(directory) / name).chmod(0o700)
            except OSError:
                pass
        try:
            Path(directory).chmod(0o700)
        except OSError:
            pass


class NativeComponentSlotTests(unittest.TestCase):
    def test_read_component_runtime_from_one_immutable_slot(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            try:
                make_slot(root)
                mime, payload, source_commit = host.read_component_slot_file(
                    str(root),
                    "/__ordax/native/component-slot/internet/0.4.0/"
                    "system/components/internet/runtime.mjs",
                )
                self.assertEqual(mime, "text/javascript; charset=utf-8")
                self.assertIn(b'version: "0.4.0"', payload)
                self.assertEqual(source_commit, COMMIT)

                css_mime, css_payload, css_commit = host.read_component_slot_file(
                    str(root),
                    "/__ordax/native/component-slot/internet/0.4.0/"
                    "system/components/internet/internet.css",
                )
                self.assertEqual(css_mime, "text/css; charset=utf-8")
                self.assertIn(b"display: block", css_payload)
                self.assertEqual(css_commit, COMMIT)
            finally:
                allow_cleanup(root)

    def test_slot_route_cannot_escape_packaged_system_tree(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            try:
                make_slot(root)
                invalid = [
                    "/__ordax/native/component-slot/internet/0.4.0/runtime-component-envelope.json",
                    "/__ordax/native/component-slot/internet/0.4.0/../component-package.json",
                    "/__ordax/native/component-slot/internet/0.4.0/system/%2e%2e/runtime.mjs",
                    "/__ordax/native/component-slot/internet/0.4.0/system/components/internet/runtime.mjs?x=1",
                ]
                for target in invalid:
                    with self.subTest(target=target):
                        with self.assertRaises(ValueError):
                            host.read_component_slot_file(str(root), target)
            finally:
                allow_cleanup(root)

    def test_writable_or_symlinked_slot_content_is_rejected(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            try:
                runtime_path = make_slot(root, writable_file=True)
                with self.assertRaises(PermissionError):
                    host.read_component_slot_file(
                        str(root),
                        "/__ordax/native/component-slot/internet/0.4.0/"
                        "system/components/internet/runtime.mjs",
                    )

                runtime_path.chmod(0o444)
                runtime_parent = runtime_path.parent
                runtime_parent.chmod(0o755)
                runtime_path.unlink()
                external = root / "outside.mjs"
                external.write_text("export default 1;\n", encoding="utf-8")
                os.symlink(external, runtime_path)
                runtime_parent.chmod(0o555)
                with self.assertRaises(OSError):
                    host.read_component_slot_file(
                        str(root),
                        "/__ordax/native/component-slot/internet/0.4.0/"
                        "system/components/internet/runtime.mjs",
                    )
            finally:
                allow_cleanup(root)

    def test_version_with_multiple_source_commits_fails_closed(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            try:
                make_slot(root)
                other = root / "internet" / "versions" / "0.4.0" / OTHER_COMMIT
                other.mkdir(parents=True)
                other.chmod(0o555)
                with self.assertRaises(host.ComponentSlotAmbiguousError):
                    host.read_component_slot_file(
                        str(root),
                        "/__ordax/native/component-slot/internet/0.4.0/"
                        "system/components/internet/runtime.mjs",
                    )
            finally:
                allow_cleanup(root)

    def test_slot_endpoint_contract_is_loopback_same_origin_and_no_cors(self):
        text = HOST_SERVER.read_text(encoding="utf-8")
        self.assertIn(
            'COMPONENT_SLOT_PREFIX = "/__ordax/native/component-slot/"',
            text,
        )
        self.assertIn(
            'DEFAULT_COMPONENT_SLOT_ROOT = "/var/lib/ordax/components"',
            text,
        )
        self.assertIn("read_component_slot_file", text)
        self.assertIn('self.send_header("Cross-Origin-Resource-Policy", "same-origin")', text)
        self.assertIn("if self.client_address[0] != \"127.0.0.1\":", text)
        self.assertNotIn("Access-Control-Allow-Origin", text)

    def test_only_explicit_component_media_types_are_served(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            try:
                make_slot(root)
                immutable_root = (
                    root / "internet" / "versions" / "0.4.0" / COMMIT
                )
                immutable_root.chmod(0o755)
                target = immutable_root / "system" / "components" / "internet" / "payload.bin"
                parent = target.parent
                parent.chmod(0o755)
                target.write_bytes(b"x")
                target.chmod(0o444)
                parent.chmod(0o555)
                immutable_root.chmod(0o555)
                with self.assertRaises(host.ComponentSlotMediaTypeError):
                    host.read_component_slot_file(
                        str(root),
                        "/__ordax/native/component-slot/internet/0.4.0/"
                        "system/components/internet/payload.bin",
                    )
            finally:
                allow_cleanup(root)


if __name__ == "__main__":
    unittest.main()
