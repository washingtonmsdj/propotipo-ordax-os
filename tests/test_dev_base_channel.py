from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import tempfile
import unittest
import urllib.error


ROOT = Path(__file__).resolve().parents[1]
BUILDER = ROOT / "tools" / "dev-base-channel" / "build.py"
CONSUMER = ROOT / "system" / "services" / "base-update" / "dev_channel.py"
SOURCE = "1" * 40


def load_module(path: Path, name: str):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


builder = load_module(BUILDER, "ordax_dev_base_builder_test")
consumer = load_module(CONSUMER, "ordax_dev_base_consumer_test")


class FakeResponse:
    def __init__(self, url: str, payload: bytes, status: int = 200):
        self._url = url
        self._payload = payload
        self.status = status

    def geturl(self):
        return self._url

    def read(self, limit: int):
        return self._payload[:limit]

    def close(self):
        pass


def write_provenance_fixture(root: Path, source_commit: str = SOURCE):
    kernel_dir = root / "kernel"
    initramfs_dir = root / "initramfs"
    kernel_dir.mkdir()
    initramfs_dir.mkdir()

    kernel_name = "vmlinuz-6.6.52"
    kernel = b"kernel-candidate-bytes\n"
    initramfs = b"initramfs-candidate-bytes\n"
    (kernel_dir / kernel_name).write_bytes(kernel)
    (initramfs_dir / "initramfs.cpio.gz").write_bytes(initramfs)

    (kernel_dir / "kernel-provenance.json").write_text(
        json.dumps({
            "$schema": "prototype-ordax.kernel-provenance/1",
            "source_commit": source_commit,
            "artifacts": {
                kernel_name: hashlib.sha256(kernel).hexdigest(),
                "kernel-modules-6.6.52.tar": "a" * 64,
            },
        }),
        encoding="utf-8",
    )
    (initramfs_dir / "initramfs-provenance.json").write_text(
        json.dumps({
            "$schema": "prototype-ordax.initramfs-provenance/1",
            "source_commit": source_commit,
            "artifacts": {
                "initramfs.cpio.gz": hashlib.sha256(initramfs).hexdigest(),
                "busybox.config": "b" * 64,
            },
        }),
        encoding="utf-8",
    )
    return kernel_dir, initramfs_dir, kernel, initramfs


class DevBaseProducerTests(unittest.TestCase):
    def test_build_binds_exact_commit_and_standard_asset_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, kernel, initramfs = write_provenance_fixture(root)
            out = root / "out"

            descriptor = builder.build(
                source_commit=SOURCE,
                kernel_dir=kernel_dir,
                initramfs_dir=initramfs_dir,
                out_dir=out,
            )

            self.assertEqual(descriptor["$schema"], builder.SCHEMA)
            self.assertEqual(descriptor["source_commit"], SOURCE)
            self.assertEqual(descriptor["tag"], f"ordax-dev-base-{SOURCE}")
            self.assertEqual(descriptor["activation"], "inactive-slot-next-boot")
            self.assertFalse(descriptor["manual_usb_rewrite_required"])
            self.assertEqual(descriptor["kernel"]["name"], "vmlinuz")
            self.assertEqual(descriptor["initramfs"]["name"], "initrd.gz")
            self.assertEqual((out / "vmlinuz").read_bytes(), kernel)
            self.assertEqual((out / "initrd.gz").read_bytes(), initramfs)
            self.assertEqual(builder.verify(out), descriptor)

    def test_build_rejects_provenance_from_another_commit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            kernel_dir, initramfs_dir, _kernel, _initramfs = write_provenance_fixture(
                root,
                source_commit="2" * 40,
            )
            with self.assertRaisesRegex(
                builder.CandidateError,
                "source commit",
            ):
                builder.build(
                    source_commit=SOURCE,
                    kernel_dir=kernel_dir,
                    initramfs_dir=initramfs_dir,
                    out_dir=root / "out",
                )


class DevBaseConsumerTests(unittest.TestCase):
    def descriptor(self, kernel: bytes, initramfs: bytes, source_commit: str = SOURCE):
        tag = f"ordax-dev-base-{source_commit}"
        prefix = (
            "https://github.com/washingtonmsdj/prototipo-ordax-os/"
            f"releases/download/{tag}"
        )
        return {
            "$schema": consumer.SCHEMA,
            "status": "development-candidate",
            "source_repository": consumer.REPOSITORY,
            "source_commit": source_commit,
            "tag": tag,
            "activation": "inactive-slot-next-boot",
            "manual_usb_rewrite_required": False,
            "kernel": {
                "name": "vmlinuz",
                "url": f"{prefix}/vmlinuz",
                "sha256": hashlib.sha256(kernel).hexdigest(),
                "size": len(kernel),
            },
            "initramfs": {
                "name": "initrd.gz",
                "url": f"{prefix}/initrd.gz",
                "sha256": hashlib.sha256(initramfs).hexdigest(),
                "size": len(initramfs),
            },
        }

    def opener_for(self, manifest: dict, kernel: bytes, initramfs: bytes):
        manifest_bytes = (
            json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        payloads = {
            consumer.manifest_url(SOURCE): manifest_bytes,
            manifest["kernel"]["url"]: kernel,
            manifest["initramfs"]["url"]: initramfs,
        }

        def open_url(url, timeout):
            self.assertEqual(timeout, consumer.DOWNLOAD_TIMEOUT_SECONDS)
            payload = payloads[url]
            return FakeResponse(url, payload)

        return open_url

    def test_acquire_materializes_exact_candidate_and_reuses_it_offline(self):
        kernel = b"kernel-dev-channel\n"
        initramfs = b"initramfs-dev-channel\n"
        manifest = self.descriptor(kernel, initramfs)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target, reused = consumer.acquire(
                SOURCE,
                root,
                opener=self.opener_for(manifest, kernel, initramfs),
            )
            self.assertFalse(reused)
            self.assertEqual(target, root / SOURCE)
            self.assertEqual((target / "vmlinuz").read_bytes(), kernel)
            self.assertEqual((target / "initrd.gz").read_bytes(), initramfs)
            self.assertEqual(
                consumer.verify_materialized(target, SOURCE)["source_commit"],
                SOURCE,
            )

            def no_network(*_args, **_kwargs):
                raise AssertionError("reused candidate unexpectedly used network")

            same, reused = consumer.acquire(SOURCE, root, opener=no_network)
            self.assertTrue(reused)
            self.assertEqual(same, target)

    def test_acquire_rejects_manifest_for_another_commit(self):
        kernel = b"kernel\n"
        initramfs = b"initramfs\n"
        wrong = self.descriptor(kernel, initramfs, source_commit="2" * 40)
        manifest_bytes = json.dumps(wrong).encode("utf-8")

        def opener(url, timeout):
            return FakeResponse(url, manifest_bytes)

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "commit does not match",
            ):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)

    def test_acquire_rejects_tampered_kernel(self):
        kernel = b"expected-kernel\n"
        initramfs = b"expected-initramfs\n"
        manifest = self.descriptor(kernel, initramfs)
        manifest_bytes = json.dumps(manifest).encode("utf-8")
        payloads = {
            consumer.manifest_url(SOURCE): manifest_bytes,
            manifest["kernel"]["url"]: b"tampered-kernel\n",
            manifest["initramfs"]["url"]: initramfs,
        }

        def opener(url, timeout):
            return FakeResponse(url, payloads[url])

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(
                consumer.DevBaseChannelError,
                "kernel (size|SHA-256) mismatch",
            ):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)

    def test_missing_exact_commit_candidate_is_retryable(self):
        def opener(url, timeout):
            raise urllib.error.HTTPError(url, 404, "missing", {}, None)

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(consumer.DevBaseCandidateUnavailable):
                consumer.acquire(SOURCE, Path(temporary), opener=opener)


if __name__ == "__main__":
    unittest.main()
