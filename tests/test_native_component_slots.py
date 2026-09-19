#!/usr/bin/env python3
"""Regress signed Native component slot state and asset integrity."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

import component_slots  # noqa: E402


SOURCE_COMMIT = "a" * 40


def file_record(relative: str, payload: bytes) -> dict:
    return {
        "path": relative,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }


class ComponentSlotFixture:
    def __init__(self, root: Path):
        self.root = root
        self.component_root = root / "components"
        self.agent = root / "release-agent"
        self.trust = root / "release-trust.json"
        self.trust.write_text("{}\n", encoding="utf-8")
        self.agent.write_text(
            f"#!{sys.executable}\n"
            "import json, os, sys\n"
            "args = sys.argv[1:]\n"
            "def value(name): return args[args.index(name) + 1]\n"
            "root = value('--root')\n"
            "component = value('--component')\n"
            "version = value('--version')\n"
            "stage = os.path.join(root, component, 'versions', version)\n"
            "manifest = json.load(open(os.path.join(stage, 'component-package.json'), encoding='utf-8'))\n"
            "sequence = int(version.split('.')[1])\n"
            "print(json.dumps({\n"
            "  'status': 'verified-staged',\n"
            "  'component_id': component,\n"
            "  'version': version,\n"
            f"  'source_commit': '{SOURCE_COMMIT}',\n"
            "  'release_sequence': sequence,\n"
            "  'entrypoint': manifest['entrypoint'],\n"
            "  'stage_path': stage,\n"
            "}))\n",
            encoding="utf-8",
        )
        self.agent.chmod(0o700)

    def stage(self, version: str, *, runtime_suffix: str = "") -> Path:
        stage = self.component_root / "internet" / "versions" / version
        runtime_path = stage / "system/components/internet/runtime.mjs"
        style_path = stage / "system/components/internet/internet.css"
        runtime_path.parent.mkdir(parents=True, exist_ok=True)
        runtime_payload = (
            f'export const version = "{version}";{runtime_suffix}\n'.encode("utf-8")
        )
        style_payload = f"/* Internet {version} */\n".encode("utf-8")
        runtime_path.write_bytes(runtime_payload)
        style_path.write_bytes(style_payload)
        manifest = {
            "$schema": "prototype-ordax.runtime-component-package/1",
            "component": {"id": "internet", "version": version},
            "entrypoint": "system/components/internet/runtime.mjs",
            "files": [
                file_record("system/components/internet/runtime.mjs", runtime_payload),
                file_record("system/components/internet/internet.css", style_payload),
            ],
        }
        (stage / "component-package.json").write_text(
            json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return stage

    def broker(self) -> component_slots.ComponentSlotBroker:
        return component_slots.ComponentSlotBroker(
            root=str(self.component_root),
            release_agent=str(self.agent),
            trust_path=str(self.trust),
        )


class ComponentSlotBrokerTests(unittest.TestCase):
    def test_prepare_promote_previous_and_rollback_are_atomic(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ComponentSlotFixture(Path(temporary))
            fixture.stage("0.3.0")
            fixture.stage("0.4.0")
            broker = fixture.broker()

            initial = broker.snapshot("internet")
            self.assertEqual(initial["revision"], 0)
            self.assertIsNone(initial["current"])
            self.assertIsNone(initial["pending"])

            prepared = broker.prepare("internet", "0.3.0")
            self.assertEqual(prepared["pending"]["version"], "0.3.0")
            self.assertTrue(prepared["pending"]["verified"])
            self.assertEqual(
                prepared["pending"]["entrypointUrl"],
                "/__ordax/component/internet/0.3.0/system/components/internet/runtime.mjs",
            )

            promoted = broker.promote("internet", "0.3.0")
            self.assertEqual(promoted["current"]["version"], "0.3.0")
            self.assertIsNone(promoted["previous"])
            self.assertIsNone(promoted["pending"])

            broker.prepare("internet", "0.4.0")
            promoted = broker.promote("internet", "0.4.0")
            self.assertEqual(promoted["current"]["version"], "0.4.0")
            self.assertEqual(promoted["previous"]["version"], "0.3.0")

            rolled_back = broker.rollback("internet")
            self.assertEqual(rolled_back["current"]["version"], "0.3.0")
            self.assertIsNone(rolled_back["previous"])
            self.assertEqual(rolled_back["rejectedVersion"], "0.4.0")

            state_path = (
                fixture.component_root / "internet" / "slot-state.json"
            )
            self.assertEqual(stat.S_IMODE(state_path.stat().st_mode), 0o600)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["currentVersion"], "0.3.0")
            self.assertGreaterEqual(state["revision"], 5)

    def test_reject_preserves_current_and_records_failed_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ComponentSlotFixture(Path(temporary))
            fixture.stage("0.3.0")
            fixture.stage("0.4.0")
            broker = fixture.broker()
            broker.prepare("internet", "0.3.0")
            broker.promote("internet", "0.3.0")
            broker.prepare("internet", "0.4.0")

            rejected = broker.reject("internet", "0.4.0")
            self.assertEqual(rejected["current"]["version"], "0.3.0")
            self.assertIsNone(rejected["pending"])
            self.assertEqual(rejected["rejectedVersion"], "0.4.0")

    def test_asset_bytes_are_hash_checked_even_after_stage_verification(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ComponentSlotFixture(Path(temporary))
            stage = fixture.stage("0.3.0")
            broker = fixture.broker()
            broker.prepare("internet", "0.3.0")

            mime, payload = broker.read_asset(
                "internet",
                "0.3.0",
                "system/components/internet/runtime.mjs",
            )
            self.assertEqual(mime, "text/javascript; charset=utf-8")
            self.assertIn(b'0.3.0', payload)

            runtime = stage / "system/components/internet/runtime.mjs"
            runtime.write_text("tampered\n", encoding="utf-8")
            with self.assertRaisesRegex(
                component_slots.ComponentSlotError,
                "integrity changed",
            ):
                broker.read_asset(
                    "internet",
                    "0.3.0",
                    "system/components/internet/runtime.mjs",
                )

    def test_assets_require_active_role_and_manifest_binding(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ComponentSlotFixture(Path(temporary))
            fixture.stage("0.3.0")
            broker = fixture.broker()

            with self.assertRaisesRegex(
                component_slots.ComponentSlotNotFound,
                "active slot role",
            ):
                broker.read_asset(
                    "internet",
                    "0.3.0",
                    "system/components/internet/runtime.mjs",
                )

            broker.prepare("internet", "0.3.0")
            with self.assertRaisesRegex(
                component_slots.ComponentSlotError,
                "unsafe|invalid",
            ):
                broker.read_asset(
                    "internet",
                    "0.3.0",
                    "system/components/internet/../runtime.mjs",
                )
            with self.assertRaisesRegex(
                component_slots.ComponentSlotNotFound,
                "package-bound",
            ):
                broker.read_asset(
                    "internet",
                    "0.3.0",
                    "system/components/internet/missing.mjs",
                )

    def test_prepare_is_idempotent_but_conflicting_pending_is_blocked(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ComponentSlotFixture(Path(temporary))
            fixture.stage("0.3.0")
            fixture.stage("0.4.0")
            broker = fixture.broker()

            first = broker.prepare("internet", "0.3.0")
            second = broker.prepare("internet", "0.3.0")
            self.assertEqual(first["revision"], second["revision"])
            with self.assertRaisesRegex(
                component_slots.ComponentSlotConflict,
                "already pending",
            ):
                broker.prepare("internet", "0.4.0")

    def test_failed_verifier_never_creates_pending_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ComponentSlotFixture(Path(temporary))
            fixture.stage("0.3.0")
            fixture.agent.write_text(
                f"#!{sys.executable}\nimport sys\nsys.exit(7)\n",
                encoding="utf-8",
            )
            fixture.agent.chmod(0o700)
            broker = fixture.broker()

            with self.assertRaisesRegex(
                component_slots.ComponentSlotError,
                "signature/integrity",
            ):
                broker.prepare("internet", "0.3.0")
            self.assertFalse(
                (fixture.component_root / "internet" / "slot-state.json").exists()
            )


if __name__ == "__main__":
    unittest.main()
