#!/usr/bin/env python3
"""Regressions for read-only OrdaX ESP discovery."""

from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system/services/base-update/esp_discovery.py"


def load_module():
    spec = spec_from_file_location("ordax_esp_discovery_test", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


esp = load_module()


class EspDiscoveryTests(unittest.TestCase):
    def fixture(self, root: Path):
        dev = root / "dev"
        by_label = dev / "disk/by-label"
        sys_class = root / "sys/class/block"
        sys_devices = root / "sys/devices/platform/fake/block"

        dev.mkdir(parents=True)
        by_label.mkdir(parents=True)
        sys_class.mkdir(parents=True)

        for name in ("sda", "sdb"):
            disk = sys_devices / name
            disk.mkdir(parents=True)
            (sys_class / name).symlink_to(disk)

        for disk_name, partitions in (("sda", ("sda1", "sda2")), ("sdb", ("sdb1",))):
            disk = sys_devices / disk_name
            for name in partitions:
                partition = disk / name
                partition.mkdir()
                (partition / "partition").write_text("1\n", encoding="ascii")
                (sys_class / name).symlink_to(partition)
                (dev / name).write_bytes(b"fixture")

        (by_label / "ORDAX-ESP").symlink_to(Path("../../sda1"))
        return dev, by_label, sys_class

    def test_identifies_same_disk_esp_without_authorizing_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dev, by_label, sys_class = self.fixture(root)
            with mock.patch.object(esp, "_is_block_device", return_value=True):
                result = esp.discover_esp(
                    root_source=dev / "sda2",
                    dev_root=dev,
                    by_label_root=by_label,
                    sys_class_block=sys_class,
                )

            self.assertEqual(result["$schema"], "prototype-ordax.esp-discovery/1")
            self.assertEqual(result["status"], "identified")
            self.assertEqual(result["filesystem_label"], "ORDAX-ESP")
            self.assertTrue(result["same_parent_disk"])
            self.assertEqual(result["parent_disk"], "sda")
            self.assertTrue(result["direct_partition_nodes"])
            self.assertFalse(result["mount_performed"])
            self.assertFalse(result["write_authorized"])
            self.assertFalse(result["activation_authorized"])
            self.assertEqual(Path(result["root_device"]), dev / "sda2")
            self.assertEqual(Path(result["esp_device"]), dev / "sda1")

    def test_rejects_same_label_on_another_disk(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dev, by_label, sys_class = self.fixture(root)
            (by_label / "ORDAX-ESP").unlink()
            (by_label / "ORDAX-ESP").symlink_to(Path("../../sdb1"))

            with mock.patch.object(esp, "_is_block_device", return_value=True):
                with self.assertRaisesRegex(
                    esp.EspDiscoveryError,
                    "not on the running root disk",
                ):
                    esp.discover_esp(
                        root_source=dev / "sda2",
                        dev_root=dev,
                        by_label_root=by_label,
                        sys_class_block=sys_class,
                    )

    def test_rejects_non_symlink_label_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dev, by_label, sys_class = self.fixture(root)
            (by_label / "ORDAX-ESP").unlink()
            (by_label / "ORDAX-ESP").write_text("sda1\n", encoding="ascii")

            with mock.patch.object(esp, "_is_block_device", return_value=True):
                with self.assertRaisesRegex(
                    esp.EspDiscoveryError,
                    "label link is missing or unsafe",
                ):
                    esp.discover_esp(
                        root_source=dev / "sda2",
                        dev_root=dev,
                        by_label_root=by_label,
                        sys_class_block=sys_class,
                    )

    def test_rejects_nested_or_mapper_style_root_device(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dev, by_label, sys_class = self.fixture(root)
            mapper = dev / "mapper"
            mapper.mkdir()
            (mapper / "ordax-root").write_bytes(b"fixture")

            with mock.patch.object(esp, "_is_block_device", return_value=True):
                with self.assertRaisesRegex(
                    esp.EspDiscoveryError,
                    "direct /dev block node",
                ):
                    esp.discover_esp(
                        root_source=mapper / "ordax-root",
                        dev_root=dev,
                        by_label_root=by_label,
                        sys_class_block=sys_class,
                    )


if __name__ == "__main__":
    unittest.main()
