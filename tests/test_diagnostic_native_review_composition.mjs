import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { SURFACE_HOST_SCHEMA } from "../system/contracts/surface-host.mjs";
import { UPDATE_STATUS_SCHEMA } from "../system/contracts/update-status.mjs";
import {
  createNativeDiagnosticReviewComposition,
} from "../system/composition/native/diagnostics.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const GENERATED_AT = "2026-09-18T23:20:00Z";

function host() {
  return Object.freeze({
    schema: SURFACE_HOST_SCHEMA,
    getSnapshot() {
      return {
        connectivity: "online",
        capabilityIds: ["filesystem.user-space"],
      };
    },
    subscribe() {
      return () => {};
    },
  });
}

function updateStatus() {
  return Object.freeze({
    schema: UPDATE_STATUS_SCHEMA,
    getSnapshot() {
      return {
        sourceSha: SOURCE_SHA,
        status: "running",
        phase: "idle",
        applyMode: "none",
        checkedAt: "2026-09-18T23:15:00Z",
      };
    },
    subscribe() {
      return () => {};
    },
  });
}

function fileSpace(onImport) {
  return Object.freeze({
    schema: FILE_SPACE_SCHEMA,
    async list() {
      return { path: "/", entries: [] };
    },
    async createDirectory() {
      return { path: "/", entries: [] };
    },
    async readTextFile() {
      throw new Error("unused");
    },
    async renameEntry() {
      throw new Error("unused");
    },
    async copyFile() {
      throw new Error("unused");
    },
    async moveEntry() {
      throw new Error("unused");
    },
    async exportFile() {
      throw new Error("unused");
    },
    async importFile(path, name, bytes) {
      onImport?.({ path, name, bytes });
      return {
        path,
        entries: [{
          name,
          kind: "file",
          size: bytes.byteLength,
          modifiedAt: 1,
        }],
      };
    },
  });
}

test("Native composition connects review to sanitized copy and confirmed Downloads persistence", async () => {
  let persisted = null;
  const copied = [];
  const controller = createNativeDiagnosticReviewComposition({
    host: host(),
    updateStatus: updateStatus(),
    fileSpace: fileSpace((value) => {
      persisted = value;
    }),
    clipboard: {
      async writeText(value) {
        copied.push(value);
      },
    },
    updateMaxAgeSeconds: 90,
    clock: () => GENERATED_AT,
  });

  const prepared = await controller.prepare();
  assert.equal(prepared.status, "ready");
  assert.equal(controller.getSnapshot().copyAvailable, true);
  assert.equal(controller.getSnapshot().exportAvailable, true);
  assert.equal(prepared.document.review.report.update.status, "running");
  assert.equal(prepared.document.review.observations.updateFreshness.state, "stale");
  assert.equal(prepared.document.review.observations.updateFreshness.ageSeconds, 300);

  const copiedResult = await controller.copyPreparedSummary();
  assert.equal(copiedResult.status, "copied");
  assert.equal(copied.length, 1);
  assert.match(copied[0], /OrdaX — resumo sanitizado de diagnóstico/);
  assert.equal(copied[0].includes(prepared.document.text), false);
  assert.equal(controller.getSnapshot().document, prepared.document);

  const exported = await controller.exportPrepared();
  assert.equal(exported.status, "saved");
  assert.equal(persisted.path, "/Downloads");
  assert.equal(persisted.name, prepared.document.fileName);
  assert.equal(new TextDecoder().decode(persisted.bytes), prepared.document.text);
});

test("Native composition without file-space or clipboard remains reviewable with outputs unavailable", async () => {
  const controller = createNativeDiagnosticReviewComposition({
    host: host(),
    fileSpace: null,
    clipboard: null,
    clock: () => GENERATED_AT,
  });

  const prepared = await controller.prepare();
  assert.equal(prepared.status, "ready");
  assert.equal(controller.getSnapshot().copyAvailable, false);
  assert.equal(controller.getSnapshot().exportAvailable, false);
  assert.deepEqual(await controller.copyPreparedSummary(), {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "copy-unavailable",
  });
  assert.deepEqual(await controller.exportPrepared(), {
    schema: "ordax.diagnostic-review-controller-result/1",
    status: "failed",
    code: "export-unavailable",
  });
});

test("Native composition fails closed when incompatible output capabilities are supplied", () => {
  assert.throws(
    () => createNativeDiagnosticReviewComposition({
      host: host(),
      fileSpace: { schema: "wrong" },
    }),
    TypeError,
  );
  assert.throws(
    () => createNativeDiagnosticReviewComposition({
      host: host(),
      clipboard: {},
    }),
    TypeError,
  );
});
