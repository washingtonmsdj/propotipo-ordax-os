import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
VERIFY_PATH = ROOT / "bootstrap" / "kernel" / "verify.py"
SPEC = importlib.util.spec_from_file_location("ordax_kernel_verify", VERIFY_PATH)
assert SPEC and SPEC.loader
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class KernelArtifactVerifierTests(unittest.TestCase):
    def make_output(self, root: Path) -> Path:
        output = root / "kernel"
        output.mkdir()
        files = {
            "vmlinuz-6.6.52": b"kernel-bytes",
            "kernel-modules-6.6.52.tar": b"module-bytes",
            "kernel-6.6.52.config": b"CONFIG_TEST=y\n",
        }
        artifact_digests = {}
        for name, data in files.items():
            (output / name).write_bytes(data)
            artifact_digests[name] = digest(data)
        provenance = {
            "$schema": "prototype-ordax.kernel-provenance/1",
            "source_commit": "1" * 40,
            "kernel_version": "6.6.52",
            "artifacts": artifact_digests,
        }
        provenance_bytes = (json.dumps(provenance, indent=2, sort_keys=True) + "\n").encode()
        (output / "kernel-provenance.json").write_bytes(provenance_bytes)
        manifest = dict(artifact_digests)
        manifest["kernel-provenance.json"] = digest(provenance_bytes)
        (output / "SHA256SUMS").write_text(
            "".join(f"{value}  {name}\n" for name, value in manifest.items()),
            encoding="utf-8",
        )
        return output

    def test_valid_output_passes_independent_of_process_cwd(self):
        with tempfile.TemporaryDirectory() as temp:
            output = self.make_output(Path(temp))
            result = VERIFY.verify_output(output)
            self.assertEqual(result["status"], "verified")
            self.assertEqual(result["artifact_count"], 4)

    def test_tampered_artifact_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            output = self.make_output(Path(temp))
            (output / "vmlinuz-6.6.52").write_bytes(b"tampered")
            with self.assertRaisesRegex(VERIFY.VerificationError, "digest mismatch"):
                VERIFY.verify_output(output)

    def test_missing_artifact_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            output = self.make_output(Path(temp))
            (output / "kernel-modules-6.6.52.tar").unlink()
            with self.assertRaisesRegex(VERIFY.VerificationError, "missing or not a regular file"):
                VERIFY.verify_output(output)

    def test_unsafe_manifest_entry_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            output = self.make_output(Path(temp))
            with (output / "SHA256SUMS").open("a", encoding="utf-8") as handle:
                handle.write(f"{'0' * 64}  ../escape\n")
            with self.assertRaisesRegex(VERIFY.VerificationError, "unsafe or malformed"):
                VERIFY.verify_output(output)


if __name__ == "__main__":
    unittest.main()
