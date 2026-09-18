import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools" / "public-site"
sys.path.insert(0, str(TOOLS))

import public_release_catalog as catalog  # noqa: E402


class PublicReleaseCatalogTests(unittest.TestCase):
    def render(self, value):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "publications.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            return catalog.render_catalog(catalog.load_publications(path))

    def base_release(self):
        commit = "1" * 40
        return {
            "release_id": commit,
            "version": "v1",
            "channel": "stable",
            "published_at": "2026-09-18T15:00:00Z",
            "source_commit": commit,
            "public_authorized": True,
            "targets": [
                {
                    "id": "creator-windows-amd64",
                    "label": "OrdaX Creator para Windows",
                    "href": "/releases/v1/ordax-creator.exe",
                    "sha256": "a" * 64,
                    "size": 1024,
                    "public_download_authorized": True,
                }
            ],
            "compliance": {
                "public_compliance_authorized": True,
                "sbom": {
                    "href": "/releases/v1/sbom.spdx.json",
                    "sha256": "b" * 64,
                    "size": 2048,
                },
                "third_party_notices": {
                    "href": "/releases/v1/THIRD-PARTY-NOTICES.txt",
                    "sha256": "c" * 64,
                    "size": 3072,
                },
                "source_bundle": {
                    "href": "/releases/v1/source-compliance.tar.xz",
                    "sha256": "d" * 64,
                    "size": 4096,
                },
            },
        }

    def test_empty_publications_render_empty_catalog(self):
        value = {
            "$schema": catalog.PUBLICATIONS_SCHEMA,
            "status": "no-public-releases",
            "releases": [],
        }
        result = self.render(value)
        self.assertEqual(result["$schema"], catalog.CATALOG_SCHEMA)
        self.assertEqual(result["status"], "empty")
        self.assertEqual(result["releases"], [])

    def test_public_authorization_is_mandatory(self):
        release = self.base_release()
        release["public_authorized"] = False
        value = {
            "$schema": catalog.PUBLICATIONS_SCHEMA,
            "status": "candidate",
            "releases": [release],
        }
        with self.assertRaises(catalog.PublicReleaseCatalogError):
            self.render(value)

    def test_target_public_authorization_is_mandatory(self):
        release = self.base_release()
        release["targets"][0]["public_download_authorized"] = False
        value = {
            "$schema": catalog.PUBLICATIONS_SCHEMA,
            "status": "candidate",
            "releases": [release],
        }
        with self.assertRaises(catalog.PublicReleaseCatalogError):
            self.render(value)

    def test_release_compliance_authorization_is_mandatory(self):
        release = self.base_release()
        release["compliance"]["public_compliance_authorized"] = False
        value = {
            "$schema": catalog.PUBLICATIONS_SCHEMA,
            "status": "candidate",
            "releases": [release],
        }
        with self.assertRaises(catalog.PublicReleaseCatalogError):
            self.render(value)

    def test_release_compliance_artifacts_are_mandatory_and_integrity_bound(self):
        for name in ("sbom", "third_party_notices", "source_bundle"):
            release = self.base_release()
            release["compliance"][name] = {
                "href": "https://example.test/compliance",
                "sha256": "x" * 64,
                "size": 0,
            }
            value = {
                "$schema": catalog.PUBLICATIONS_SCHEMA,
                "status": "candidate",
                "releases": [release],
            }
            with self.subTest(name=name):
                with self.assertRaises(catalog.PublicReleaseCatalogError):
                    self.render(value)

    def test_download_path_must_be_clean_same_origin(self):
        for href in (
            "https://example.test/file",
            "//example.test/file",
            "relative/file",
            "/release/file?token=secret",
            "/release/file#fragment",
        ):
            release = self.base_release()
            release["targets"][0]["href"] = href
            value = {
                "$schema": catalog.PUBLICATIONS_SCHEMA,
                "status": "candidate",
                "releases": [release],
            }
            with self.subTest(href=href):
                with self.assertRaises(catalog.PublicReleaseCatalogError):
                    self.render(value)

    def test_duplicate_release_ids_are_rejected(self):
        release = self.base_release()
        value = {
            "$schema": catalog.PUBLICATIONS_SCHEMA,
            "status": "candidate",
            "releases": [release, dict(release)],
        }
        with self.assertRaises(catalog.PublicReleaseCatalogError):
            self.render(value)

    def test_valid_release_catalog_omits_internal_authorization_flags(self):
        release = self.base_release()
        value = {
            "$schema": catalog.PUBLICATIONS_SCHEMA,
            "status": "public",
            "releases": [release],
        }
        result = self.render(value)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(len(result["releases"]), 1)
        rendered = result["releases"][0]
        self.assertNotIn("public_authorized", rendered)
        self.assertNotIn("public_download_authorized", rendered["targets"][0])
        self.assertNotIn("public_compliance_authorized", rendered["compliance"])
        self.assertEqual(rendered["release_id"], release["release_id"])
        self.assertEqual(rendered["targets"][0]["sha256"], "a" * 64)
        self.assertEqual(rendered["compliance"]["sbom"]["sha256"], "b" * 64)
        self.assertEqual(
            rendered["compliance"]["third_party_notices"]["href"],
            "/releases/v1/THIRD-PARTY-NOTICES.txt",
        )
        self.assertEqual(
            rendered["compliance"]["source_bundle"]["size"],
            4096,
        )


if __name__ == "__main__":
    unittest.main()
