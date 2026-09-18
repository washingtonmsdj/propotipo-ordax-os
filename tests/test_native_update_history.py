import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
CONTRACT = ROOT / "system" / "contracts" / "update-history.mjs"
ADAPTER = ROOT / "system" / "adapters" / "native" / "update-history.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"

spec = importlib.util.spec_from_file_location("ordax_native_update_history_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class NativeUpdateHistoryTests(unittest.TestCase):
    def test_release_history_is_bounded_validated_and_newest_first(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "release-history.tsv"
            path.write_text(
                "124\t2026-09-18T09:00:00-03:00\t" + "a" * 40 + "\tVersão e histórico\n"
                "123\t2026-09-18T08:34:15-03:00\t" + "b" * 40 + "\tRede nativa somente leitura\n"
                "bad\tnope\tinvalid\tignored\n",
                encoding="utf-8",
            )
            releases = native_host.read_release_history(str(path))
            self.assertEqual([entry["versionNumber"] for entry in releases], [124, 123])
            self.assertEqual(releases[0]["title"], "Versão e histórico")

    def test_application_history_is_newest_first_and_ignores_malformed_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "update-history.tsv"
            path.write_text(
                "123\t2026-09-18T11:34:47Z\t" + "b" * 40 + "\tsurface-restart\tapplied\t27\t2\n"
                "124\t2026-09-18T12:00:00Z\t" + "a" * 40 + "\tsupervisor-restart\tapplied\t31\t1\n"
                "124\tbad\t" + "a" * 40 + "\tunknown\tapplied\t1\t0\n",
                encoding="utf-8",
            )
            applications = native_host.read_application_history(str(path))
            self.assertEqual([entry["versionNumber"] for entry in applications], [124, 123])
            self.assertEqual(applications[0]["applyDurationSeconds"], 31)
            self.assertEqual(applications[0]["stageDurationSeconds"], 1)

    def test_history_reader_does_not_expose_arbitrary_columns(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            releases = root / "release.tsv"
            applications = root / "applications.tsv"
            releases.write_text(
                "124\t2026-09-18T09:00:00-03:00\t" + "a" * 40 + "\tVersão e histórico\n",
                encoding="utf-8",
            )
            applications.write_text(
                "124\t2026-09-18T12:00:00Z\t" + "a" * 40 + "\treload\tapplied\t5\t0\n",
                encoding="utf-8",
            )
            previous_release_history = native_host.RELEASE_HISTORY_FILE
            previous_update_history = native_host.UPDATE_HISTORY_FILE
            try:
                native_host.RELEASE_HISTORY_FILE = str(releases)
                native_host.UPDATE_HISTORY_FILE = str(applications)
                snapshot = native_host.read_update_history()
                self.assertEqual(
                    set(snapshot["releases"][0]),
                    {"versionNumber", "sourceSha", "releasedAt", "title"},
                )
                self.assertEqual(
                    set(snapshot["applications"][0]),
                    {
                        "versionNumber",
                        "sourceSha",
                        "appliedAt",
                        "applyMode",
                        "result",
                        "applyDurationSeconds",
                        "stageDurationSeconds",
                    },
                )
            finally:
                native_host.RELEASE_HISTORY_FILE = previous_release_history
                native_host.UPDATE_HISTORY_FILE = previous_update_history

    def test_contract_adapter_and_native_composition_use_read_only_port(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn('ordax.update-history/1', contract)
        self.assertIn("validateUpdateHistorySnapshot", contract)
        self.assertIn('UPDATE_HISTORY_ENDPOINT = "/__ordax/native/update-history"', adapter)
        self.assertIn("async list()", adapter)
        self.assertNotIn("POST", adapter)
        self.assertIn("createNativeUpdateHistory", composition)
        self.assertIn("updateHistory", composition)

    def test_host_history_endpoint_is_loopback_get_only(self):
        server = SERVER.read_text(encoding="utf-8")
        self.assertIn('UPDATE_HISTORY_PATH = "/__ordax/native/update-history"', server)
        self.assertIn("read_update_history()", server)
        self.assertIn("UPDATE_HISTORY_PATH", server.split("def do_GET", 1)[1].split("def do_POST", 1)[0])
        self.assertNotIn("if self.path == UPDATE_HISTORY_PATH", server.split("def do_POST", 1)[1])


if __name__ == "__main__":
    unittest.main()
