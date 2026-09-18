"""Validate and render the public OrdaX release catalog."""

from __future__ import annotations

import json
import re
from pathlib import Path

PUBLICATIONS_SCHEMA = "prototype-ordax.public-release-publications/1"
CATALOG_SCHEMA = "prototype-ordax.public-release-catalog/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_PUBLICATION_KEYS = {"$schema", "status", "releases"}
ALLOWED_RELEASE_KEYS = {
    "release_id",
    "version",
    "channel",
    "published_at",
    "source_commit",
    "public_authorized",
    "targets",
    "compliance",
}
ALLOWED_TARGET_KEYS = {
    "id",
    "label",
    "href",
    "sha256",
    "size",
    "public_download_authorized",
}
ALLOWED_COMPLIANCE_KEYS = {
    "public_compliance_authorized",
    "sbom",
    "third_party_notices",
    "source_bundle",
}
ALLOWED_COMPLIANCE_ARTIFACT_KEYS = {"href", "sha256", "size"}
CATALOG_RELEASE_KEYS = {
    "release_id",
    "version",
    "channel",
    "published_at",
    "source_commit",
    "targets",
    "compliance",
}
CATALOG_TARGET_KEYS = {"id", "label", "href", "sha256", "size"}


class PublicReleaseCatalogError(ValueError):
    pass


def _same_origin_path(value: object) -> bool:
    return (
        isinstance(value, str)
        and value.startswith("/")
        and not value.startswith("//")
        and "?" not in value
        and "#" not in value
    )


def _require_exact_keys(value: dict, allowed: set[str], context: str) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise PublicReleaseCatalogError(
            f"{context} contains unknown fields: {sorted(unknown)}"
        )


def _render_integrity_artifact(value: object, context: str) -> dict:
    if not isinstance(value, dict):
        raise PublicReleaseCatalogError(f"{context} must be an object")
    _require_exact_keys(value, ALLOWED_COMPLIANCE_ARTIFACT_KEYS, context)

    href = value.get("href")
    sha256 = value.get("sha256")
    size = value.get("size")
    if not _same_origin_path(href):
        raise PublicReleaseCatalogError(
            f"{context}.href must be a clean same-origin path"
        )
    if not isinstance(sha256, str) or not SHA256_RE.fullmatch(sha256):
        raise PublicReleaseCatalogError(
            f"{context}.sha256 must be lowercase 64-hex"
        )
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise PublicReleaseCatalogError(
            f"{context}.size must be a positive integer"
        )
    return {"href": href, "sha256": sha256, "size": size}


def load_publications(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise PublicReleaseCatalogError("publications root must be an object")
    _require_exact_keys(value, ALLOWED_PUBLICATION_KEYS, "publications")
    if value.get("$schema") != PUBLICATIONS_SCHEMA:
        raise PublicReleaseCatalogError("unexpected publications schema")
    if not isinstance(value.get("status"), str) or not value["status"]:
        raise PublicReleaseCatalogError("publications status is required")
    releases = value.get("releases")
    if not isinstance(releases, list):
        raise PublicReleaseCatalogError("publications releases must be an array")
    return value


def render_catalog(publications: dict) -> dict:
    releases_out = []
    release_ids: set[str] = set()

    for index, release in enumerate(publications["releases"]):
        context = f"release[{index}]"
        if not isinstance(release, dict):
            raise PublicReleaseCatalogError(f"{context} must be an object")
        _require_exact_keys(release, ALLOWED_RELEASE_KEYS, context)

        release_id = release.get("release_id")
        source_commit = release.get("source_commit")
        version = release.get("version")
        channel = release.get("channel")
        published_at = release.get("published_at")
        targets = release.get("targets")
        compliance = release.get("compliance")

        if release.get("public_authorized") is not True:
            raise PublicReleaseCatalogError(
                f"{context} is not explicitly authorized for public publication"
            )
        if not isinstance(release_id, str) or not SHA40_RE.fullmatch(release_id):
            raise PublicReleaseCatalogError(f"{context}.release_id must be a 40-hex commit")
        if release_id in release_ids:
            raise PublicReleaseCatalogError(f"duplicate release_id: {release_id}")
        release_ids.add(release_id)
        if source_commit != release_id or not SHA40_RE.fullmatch(str(source_commit)):
            raise PublicReleaseCatalogError(
                f"{context}.source_commit must equal release_id"
            )
        for name, value in (
            ("version", version),
            ("channel", channel),
            ("published_at", published_at),
        ):
            if not isinstance(value, str) or not value.strip():
                raise PublicReleaseCatalogError(f"{context}.{name} is required")
        if not isinstance(targets, list) or not targets:
            raise PublicReleaseCatalogError(f"{context}.targets must be a non-empty array")

        if not isinstance(compliance, dict):
            raise PublicReleaseCatalogError(f"{context}.compliance must be an object")
        _require_exact_keys(compliance, ALLOWED_COMPLIANCE_KEYS, f"{context}.compliance")
        if compliance.get("public_compliance_authorized") is not True:
            raise PublicReleaseCatalogError(
                f"{context}.compliance is not explicitly authorized for public publication"
            )
        compliance_out = {
            name: _render_integrity_artifact(
                compliance.get(name),
                f"{context}.compliance.{name}",
            )
            for name in ("sbom", "third_party_notices", "source_bundle")
        }

        target_ids: set[str] = set()
        targets_out = []
        for target_index, target in enumerate(targets):
            target_context = f"{context}.targets[{target_index}]"
            if not isinstance(target, dict):
                raise PublicReleaseCatalogError(f"{target_context} must be an object")
            _require_exact_keys(target, ALLOWED_TARGET_KEYS, target_context)
            if target.get("public_download_authorized") is not True:
                raise PublicReleaseCatalogError(
                    f"{target_context} is not explicitly authorized for public download"
                )

            target_id = target.get("id")
            label = target.get("label")
            href = target.get("href")
            sha256 = target.get("sha256")
            size = target.get("size")
            if not isinstance(target_id, str) or not target_id.strip():
                raise PublicReleaseCatalogError(f"{target_context}.id is required")
            if target_id in target_ids:
                raise PublicReleaseCatalogError(
                    f"duplicate target id {target_id!r} in {release_id}"
                )
            target_ids.add(target_id)
            if not isinstance(label, str) or not label.strip():
                raise PublicReleaseCatalogError(f"{target_context}.label is required")
            if not _same_origin_path(href):
                raise PublicReleaseCatalogError(
                    f"{target_context}.href must be a clean same-origin path"
                )
            if not isinstance(sha256, str) or not SHA256_RE.fullmatch(sha256):
                raise PublicReleaseCatalogError(
                    f"{target_context}.sha256 must be lowercase 64-hex"
                )
            if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
                raise PublicReleaseCatalogError(
                    f"{target_context}.size must be a positive integer"
                )

            targets_out.append(
                {
                    "id": target_id,
                    "label": label,
                    "href": href,
                    "sha256": sha256,
                    "size": size,
                }
            )

        releases_out.append(
            {
                "release_id": release_id,
                "version": version,
                "channel": channel,
                "published_at": published_at,
                "source_commit": source_commit,
                "targets": targets_out,
                "compliance": compliance_out,
            }
        )

    return {
        "$schema": CATALOG_SCHEMA,
        "status": "ready" if releases_out else "empty",
        "releases": releases_out,
    }


def write_catalog(publications_path: Path, destination: Path) -> dict:
    publications = load_publications(publications_path)
    catalog = render_catalog(publications)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(catalog, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return catalog


def validate_catalog(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("$schema") != CATALOG_SCHEMA:
        raise PublicReleaseCatalogError("unexpected public release catalog schema")
    if set(value) != {"$schema", "status", "releases"}:
        raise PublicReleaseCatalogError("public release catalog root fields are invalid")
    if value.get("status") not in {"empty", "ready"}:
        raise PublicReleaseCatalogError("invalid public release catalog status")
    releases = value.get("releases")
    if not isinstance(releases, list):
        raise PublicReleaseCatalogError("catalog releases must be an array")
    if value["status"] == "empty" and releases:
        raise PublicReleaseCatalogError("empty catalog cannot contain releases")
    if value["status"] == "ready" and not releases:
        raise PublicReleaseCatalogError("ready catalog must contain releases")

    release_ids: set[str] = set()
    for index, release in enumerate(releases):
        context = f"catalog.release[{index}]"
        if not isinstance(release, dict):
            raise PublicReleaseCatalogError(f"{context} must be an object")
        if set(release) != CATALOG_RELEASE_KEYS:
            raise PublicReleaseCatalogError(f"{context} fields are invalid")
        release_id = release.get("release_id")
        if not isinstance(release_id, str) or not SHA40_RE.fullmatch(release_id):
            raise PublicReleaseCatalogError(f"{context}.release_id is invalid")
        if release_id in release_ids:
            raise PublicReleaseCatalogError(f"duplicate catalog release_id: {release_id}")
        release_ids.add(release_id)
        if release.get("source_commit") != release_id:
            raise PublicReleaseCatalogError(f"{context}.source_commit mismatch")

        targets = release.get("targets")
        if not isinstance(targets, list) or not targets:
            raise PublicReleaseCatalogError(f"{context}.targets must be non-empty")
        for target_index, target in enumerate(targets):
            target_context = f"{context}.targets[{target_index}]"
            if not isinstance(target, dict) or set(target) != CATALOG_TARGET_KEYS:
                raise PublicReleaseCatalogError(f"{target_context} fields are invalid")
            if not isinstance(target.get("id"), str) or not target["id"].strip():
                raise PublicReleaseCatalogError(f"{target_context}.id is invalid")
            if not isinstance(target.get("label"), str) or not target["label"].strip():
                raise PublicReleaseCatalogError(f"{target_context}.label is invalid")
            _render_integrity_artifact(
                {
                    "href": target.get("href"),
                    "sha256": target.get("sha256"),
                    "size": target.get("size"),
                },
                target_context,
            )

        compliance = release.get("compliance")
        if not isinstance(compliance, dict) or set(compliance) != {
            "sbom",
            "third_party_notices",
            "source_bundle",
        }:
            raise PublicReleaseCatalogError(f"{context}.compliance fields are invalid")
        for name in ("sbom", "third_party_notices", "source_bundle"):
            _render_integrity_artifact(compliance.get(name), f"{context}.compliance.{name}")

    return value
