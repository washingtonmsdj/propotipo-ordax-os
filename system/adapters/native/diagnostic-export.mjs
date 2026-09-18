import {
  DIAGNOSTIC_EXPORT_SCHEMA,
  assertDiagnosticExportPort,
  validateDiagnosticExportDocument,
} from "../../contracts/diagnostic-export.mjs";
import { assertFileSpacePort } from "../../contracts/file-space.mjs";

export const NATIVE_DIAGNOSTIC_EXPORT_DIRECTORY = "/Downloads";

function requirePersistedDiagnostic(listing, document, byteLength) {
  if (!listing || typeof listing !== "object" || listing.path !== NATIVE_DIAGNOSTIC_EXPORT_DIRECTORY) {
    throw new TypeError("Native diagnostic export did not confirm the Downloads listing");
  }
  if (!Array.isArray(listing.entries)) {
    throw new TypeError("Native diagnostic export requires a confirmed file listing");
  }

  const entry = listing.entries.find((candidate) => candidate?.name === document.fileName);
  if (!entry || entry.kind !== "file" || entry.size !== byteLength) {
    throw new TypeError("Native diagnostic export did not confirm the persisted file");
  }
}

export function createNativeDiagnosticExport(
  fileSpace,
  { TextEncoderCtor = globalThis.TextEncoder } = {},
) {
  const files = assertFileSpacePort(fileSpace);
  if (typeof TextEncoderCtor !== "function") {
    throw new TypeError("Native diagnostic export requires TextEncoder");
  }
  const encoder = new TextEncoderCtor();

  const port = {
    schema: DIAGNOSTIC_EXPORT_SCHEMA,
    async save(value) {
      const document = validateDiagnosticExportDocument(value);
      const bytes = encoder.encode(document.text);
      const listing = await files.importFile(
        NATIVE_DIAGNOSTIC_EXPORT_DIRECTORY,
        document.fileName,
        bytes,
      );
      requirePersistedDiagnostic(listing, document, bytes.byteLength);
      return Object.freeze({ status: "saved" });
    },
  };

  assertDiagnosticExportPort(port);
  return Object.freeze(port);
}
