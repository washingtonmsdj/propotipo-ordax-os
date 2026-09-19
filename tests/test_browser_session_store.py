from pathlib import Path
import importlib.util
import json
import os
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "system" / "surface" / "runtime" / "browser_session_store.py"

spec = importlib.util.spec_from_file_location("browser_session_store", MODULE_PATH)
store = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(store)


def public_url(value: str) -> bool:
    return value.startswith("https://") and "localhost" not in value and "127.0.0.1" not in value


class BrowserSessionStoreTests(unittest.TestCase):
    def test_normalize_filters_untrusted_urls_and_remaps_active_index(self):
        session = store.normalize_session(
            {
                "version": 1,
                "urls": [
                    "https://example.org/a",
                    "http://127.0.0.1/private",
                    "https://example.org/b",
                ],
                "activeIndex": 2,
            },
            allow_url=public_url,
        )
        self.assertEqual(
            session.urls,
            ("https://example.org/a", "https://example.org/b"),
        )
        self.assertEqual(session.active_index, 1)

    def test_invalid_or_unknown_state_fails_closed(self):
        self.assertEqual(
            store.normalize_session({"version": 999, "urls": ["https://example.org"]}, allow_url=public_url),
            store.empty_session(),
        )
        self.assertEqual(
            store.normalize_session({"version": 1, "urls": "https://example.org"}, allow_url=public_url),
            store.empty_session(),
        )

    def test_limit_is_enforced_without_changing_order(self):
        urls = [f"https://example.org/{index}" for index in range(30)]
        session = store.normalize_session(
            {"version": 1, "urls": urls, "activeIndex": 29},
            allow_url=public_url,
            max_tabs=16,
        )
        self.assertEqual(session.urls, tuple(urls[:16]))
        self.assertEqual(session.active_index, 15)

    def test_corrupt_missing_and_oversized_files_return_empty_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.json"
            self.assertEqual(
                store.load_browser_session(str(path), allow_url=public_url),
                store.empty_session(),
            )
            path.write_text("{broken", encoding="utf-8")
            self.assertEqual(
                store.load_browser_session(str(path), allow_url=public_url),
                store.empty_session(),
            )
            path.write_bytes(b"x" * (store.MAX_SESSION_BYTES + 1))
            self.assertEqual(
                store.load_browser_session(str(path), allow_url=public_url),
                store.empty_session(),
            )

    def test_save_is_atomic_private_and_round_trips_filtered_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.json"
            saved = store.save_browser_session(
                str(path),
                [
                    "https://example.org/one",
                    "http://127.0.0.1/nope",
                    "https://example.org/two",
                ],
                2,
                allow_url=public_url,
            )
            self.assertEqual(
                saved.urls,
                ("https://example.org/one", "https://example.org/two"),
            )
            self.assertEqual(saved.active_index, 1)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(any(item.name.startswith(".browser-session-") for item in Path(directory).iterdir()))

            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["version"], 1)
            self.assertEqual(payload["activeIndex"], 1)
            self.assertEqual(payload["urls"], list(saved.urls))
            self.assertEqual(
                store.load_browser_session(str(path), allow_url=public_url),
                saved,
            )

    def test_symlink_session_file_is_not_read(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target.json"
            target.write_text(
                json.dumps({"version": 1, "urls": ["https://example.org"], "activeIndex": 0}),
                encoding="utf-8",
            )
            path = Path(directory) / "session.json"
            try:
                os.symlink(target, path)
            except (OSError, NotImplementedError):
                self.skipTest("symlinks unavailable")
            self.assertEqual(
                store.load_browser_session(str(path), allow_url=public_url),
                store.empty_session(),
            )


if __name__ == "__main__":
    unittest.main()
