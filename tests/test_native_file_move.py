import errno
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"

spec = importlib.util.spec_from_file_location("ordax_native_host_move_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeFileMoveTests(unittest.TestCase):
    def test_file_and_directory_move_is_no_clobber_within_user_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "Documentos").mkdir()
            (user_root / "Downloads").mkdir()
            (user_root / "note.txt").write_text("ordax", encoding="utf-8")

            listing = native_host.move_user_entry(
                str(user_root), "/", "note.txt", "/Documentos"
            )
            self.assertFalse((user_root / "note.txt").exists())
            self.assertEqual(
                (user_root / "Documentos" / "note.txt").read_text(encoding="utf-8"),
                "ordax",
            )
            self.assertEqual(listing["path"], "/Documentos")

            (user_root / "folder").mkdir()
            (user_root / "folder" / "inside.txt").write_text("inside", encoding="utf-8")
            native_host.move_user_entry(str(user_root), "/", "folder", "/Downloads")
            self.assertFalse((user_root / "folder").exists())
            self.assertEqual(
                (user_root / "Downloads" / "folder" / "inside.txt").read_text(encoding="utf-8"),
                "inside",
            )

            (user_root / "conflict.txt").write_text("source", encoding="utf-8")
            (user_root / "Documentos" / "conflict.txt").write_text("keep", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                native_host.move_user_entry(
                    str(user_root), "/", "conflict.txt", "/Documentos"
                )
            self.assertEqual((user_root / "conflict.txt").read_text(encoding="utf-8"), "source")
            self.assertEqual(
                (user_root / "Documentos" / "conflict.txt").read_text(encoding="utf-8"),
                "keep",
            )

    def test_directory_cannot_be_moved_into_itself_or_descendant(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "parent").mkdir()
            (user_root / "parent" / "child").mkdir()

            with self.assertRaises(ValueError):
                native_host.move_user_entry(str(user_root), "/", "parent", "/parent")
            with self.assertRaises(ValueError):
                native_host.move_user_entry(str(user_root), "/", "parent", "/parent/child")
            self.assertTrue((user_root / "parent" / "child").is_dir())

    def test_symlink_source_is_rejected_and_never_followed(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            user_root = base / "home"
            outside = base / "outside"
            user_root.mkdir()
            outside.mkdir()
            (user_root / "Documentos").mkdir()
            (outside / "secret.txt").write_text("blocked", encoding="utf-8")
            os.symlink(outside / "secret.txt", user_root / "link.txt")

            with self.assertRaises(ValueError):
                native_host.move_user_entry(str(user_root), "/", "link.txt", "/Documentos")
            self.assertTrue((user_root / "link.txt").is_symlink())
            self.assertFalse((user_root / "Documentos" / "link.txt").exists())

    def test_cross_device_regular_file_move_uses_copy_verify_remove(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "Documentos").mkdir()
            (user_root / "note.txt").write_text("ordax", encoding="utf-8")

            with mock.patch.object(
                native_host,
                "_renameat2_noreplace_between",
                side_effect=OSError(errno.EXDEV, "simulated cross-device move"),
            ):
                listing = native_host.move_user_entry(
                    str(user_root), "/", "note.txt", "/Documentos"
                )

            self.assertFalse((user_root / "note.txt").exists())
            self.assertEqual(
                (user_root / "Documentos" / "note.txt").read_text(encoding="utf-8"),
                "ordax",
            )
            self.assertEqual(listing["path"], "/Documentos")

    def test_cross_device_directory_move_is_explicitly_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "Documentos").mkdir()
            (user_root / "folder").mkdir()
            (user_root / "folder" / "inside.txt").write_text("keep", encoding="utf-8")

            with mock.patch.object(
                native_host,
                "_renameat2_noreplace_between",
                side_effect=OSError(errno.EXDEV, "simulated cross-device move"),
            ):
                with self.assertRaises(native_host.FileSpaceCrossDeviceMoveError):
                    native_host.move_user_entry(
                        str(user_root), "/", "folder", "/Documentos"
                    )

            self.assertTrue((user_root / "folder" / "inside.txt").is_file())
            self.assertFalse((user_root / "Documentos" / "folder").exists())

    def test_cross_device_file_move_preserves_origin_when_source_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "Documentos").mkdir()
            source = user_root / "note.txt"
            source.write_text("ordax", encoding="utf-8")
            real_stat = native_host.os.stat
            source_stat_calls = 0

            def changed_source_stat(path, *args, **kwargs):
                nonlocal source_stat_calls
                result = real_stat(path, *args, **kwargs)
                if (
                    path == "note.txt"
                    and kwargs.get("dir_fd") is not None
                    and kwargs.get("follow_symlinks") is False
                ):
                    source_stat_calls += 1
                    if source_stat_calls == 2:
                        class Changed:
                            st_dev = result.st_dev
                            st_ino = result.st_ino + 1
                            st_size = result.st_size
                            st_mtime_ns = result.st_mtime_ns
                            st_ctime_ns = result.st_ctime_ns
                            st_mode = result.st_mode
                        return Changed()
                return result

            with (
                mock.patch.object(
                    native_host,
                    "_renameat2_noreplace_between",
                    side_effect=OSError(errno.EXDEV, "simulated cross-device move"),
                ),
                mock.patch.object(native_host.os, "stat", side_effect=changed_source_stat),
            ):
                with self.assertRaises(native_host.FileSpaceCopyChangedError):
                    native_host.move_user_entry(
                        str(user_root), "/", "note.txt", "/Documentos"
                    )

            self.assertEqual(source.read_text(encoding="utf-8"), "ordax")
            self.assertFalse((user_root / "Documentos" / "note.txt").exists())

    def test_cross_device_file_move_respects_copy_size_limit(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "Documentos").mkdir()
            source = user_root / "large.bin"
            source.write_bytes(b"12345")

            with mock.patch.object(
                native_host,
                "_renameat2_noreplace_between",
                side_effect=OSError(errno.EXDEV, "simulated cross-device move"),
            ):
                with self.assertRaises(native_host.FileSpaceCopyTooLargeError):
                    native_host.move_user_entry(
                        str(user_root),
                        "/",
                        "large.bin",
                        "/Documentos",
                        max_bytes=4,
                    )

            self.assertEqual(source.read_bytes(), b"12345")
            self.assertFalse((user_root / "Documentos" / "large.bin").exists())

    def test_same_directory_move_is_a_noop(self):
        with tempfile.TemporaryDirectory() as temporary:
            user_root = Path(temporary) / "home"
            user_root.mkdir()
            (user_root / "note.txt").write_text("ordax", encoding="utf-8")
            listing = native_host.move_user_entry(str(user_root), "/", "note.txt", "/")
            self.assertEqual(listing["path"], "/")
            self.assertEqual((user_root / "note.txt").read_text(encoding="utf-8"), "ordax")


if __name__ == "__main__":
    unittest.main()
