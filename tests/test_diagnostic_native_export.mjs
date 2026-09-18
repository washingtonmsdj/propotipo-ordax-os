import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import {
  createNativeDiagnosticExport,
  NATIVE_DIAGNOSTIC_EXPORT_DIRECTORY,
} from "../system/adapters/native/diagnostic-export.mjs";
import { exportDiagnosticDocument } from "../system/services/diagnostics/export.mjs";

function exportDocument(overrides = {}) {
  return {
    fileName: "ordax-diagnostico-2026-09-18T22-30-00Z.json",
    mediaType: "application/json",
    text: '{"schema":"ordax.diagnostic-review/1","message":"Olá OrdaX"}\n',
    ...overrides,
  };
}

function createFileSpace({ importFile } = {}) {
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
    importFile: importFile ?? (async (path, name, bytes) => ({
      path,
      entries: [{
        name,
        kind: "file",
        size: bytes.byteLength,
        modifiedAt: 1,
      }],
    })),
  });
}

test("Native diagnostic export persists exact UTF-8 bytes through bounded user file-space", async () => {
  let observed = null;
  const fileSpace = createFileSpace({
    async importFile(path, name, bytes) {
      observed = { path, name, bytes };
      return {
        path,
        entries: [{ name, kind: "file", size: bytes.byteLength, modifiedAt: 123 }],
      };
    },
  });
  const port = createNativeDiagnosticExport(fileSpace);
  const document = exportDocument();

  const result = await port.save(document);

  assert.deepEqual(result, { status: "saved" });
  assert.equal(observed.path, NATIVE_DIAGNOSTIC_EXPORT_DIRECTORY);
  assert.equal(observed.path, "/Downloads");
  assert.equal(observed.name, document.fileName);
  assert.ok(observed.bytes instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(observed.bytes), document.text);
});

test("saved is returned only after file-space confirms path, type and byte size", async () => {
  const document = exportDocument();
  const cases = [
    {
      name: "wrong directory",
      listing: { path: "/Documentos", entries: [] },
    },
    {
      name: "missing file",
      listing: { path: "/Downloads", entries: [] },
    },
    {
      name: "directory instead of file",
      listing: {
        path: "/Downloads",
        entries: [{ name: document.fileName, kind: "directory", size: 0, modifiedAt: 1 }],
      },
    },
    {
      name: "wrong persisted size",
      listing: {
        path: "/Downloads",
        entries: [{ name: document.fileName, kind: "file", size: 1, modifiedAt: 1 }],
      },
    },
  ];

  for (const scenario of cases) {
    await assert.rejects(
      () => createNativeDiagnosticExport(createFileSpace({
        async importFile() {
          return scenario.listing;
        },
      })).save(document),
      TypeError,
      scenario.name,
    );
  }
});

test("host persistence failure remains a stable diagnostic export failure", async () => {
  const fileSpace = createFileSpace({
    async importFile() {
      throw new Error("disk error token=do-not-export user@example.com 10.20.30.40");
    },
  });
  const port = createNativeDiagnosticExport(fileSpace);

  const result = await exportDiagnosticDocument(exportDocument(), port);

  assert.deepEqual(result, {
    schema: "ordax.diagnostic-export-result/1",
    status: "failed",
    code: "export-failed",
  });
  assert.doesNotMatch(JSON.stringify(result), /do-not-export|user@example\.com|10\.20\.30\.40/);
});

test("duplicate or no-clobber rejection is not misreported as saved", async () => {
  const fileSpace = createFileSpace({
    async importFile() {
      const error = new Error("already exists");
      error.status = 409;
      throw error;
    },
  });
  const result = await exportDiagnosticDocument(
    exportDocument(),
    createNativeDiagnosticExport(fileSpace),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.code, "export-failed");
});

test("adapter validates document before touching file-space", async () => {
  let calls = 0;
  const port = createNativeDiagnosticExport(createFileSpace({
    async importFile() {
      calls += 1;
      return { path: "/Downloads", entries: [] };
    },
  }));

  await assert.rejects(
    () => port.save(exportDocument({ fileName: "../escape.json" })),
    TypeError,
  );
  assert.equal(calls, 0);
});

test("adapter requires a real file-space port and UTF-8 encoder", () => {
  assert.throws(() => createNativeDiagnosticExport(null), TypeError);
  assert.throws(
    () => createNativeDiagnosticExport(createFileSpace(), { TextEncoderCtor: null }),
    TypeError,
  );
});
