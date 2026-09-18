import {
  FILE_SPACE_SCHEMA,
  assertFileSpacePort,
  validateFileListing,
  validateTextFile,
} from "../../contracts/file-space.mjs";

const FILES_ENDPOINT = "/__ordax/native/files";
const FILE_CONTENT_ENDPOINT = "/__ordax/native/file-content";
const FILE_EXPORT_ENDPOINT = "/__ordax/native/file-export";

export class FileSpaceOperationError extends Error {
  constructor(operation, status) {
    super(`Native file-space ${operation} failed: ${status}`);
    this.name = "FileSpaceOperationError";
    this.operation = operation;
    this.status = status;
  }
}

function requireSuccess(response, operation) {
  if (!response.ok) {
    throw new FileSpaceOperationError(operation, response.status);
  }
  return response;
}

function endpointFor(path) {
  return `${FILES_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function contentEndpointFor(path) {
  return `${FILE_CONTENT_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function exportEndpointFor(path) {
  return `${FILE_EXPORT_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function fileNameFromPath(path) {
  const parts = String(path).split("/").filter(Boolean);
  return parts[parts.length - 1] || "arquivo";
}

export async function createNativeFileSpace(windowRef = globalThis.window) {
  if (!windowRef || typeof windowRef.fetch !== "function") {
    throw new TypeError("Native file-space adapter requires window.fetch");
  }

  const requestListing = async (path) => {
    const response = await windowRef.fetch(endpointFor(path), {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    requireSuccess(response, "listing");
    return validateFileListing(await response.json());
  };

  // Probe the bounded user root before advertising this capability.
  await requestListing("/");

  const port = {
    schema: FILE_SPACE_SCHEMA,
    list(path = "/") {
      return requestListing(path);
    },
    async readTextFile(path) {
      const response = await windowRef.fetch(contentEndpointFor(path), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      requireSuccess(response, "text-read");
      return validateTextFile(await response.json());
    },
    async copyFile(path, name, newName) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "copy-file", path, name, newName }),
      });
      requireSuccess(response, "copy");
      return validateFileListing(await response.json());
    },
    async renameEntry(path, name, newName) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename-entry", path, name, newName }),
      });
      requireSuccess(response, "rename");
      return validateFileListing(await response.json());
    },
    async moveEntry(sourcePath, name, destinationPath) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "move-entry",
          sourcePath,
          name,
          destinationPath,
        }),
      });
      requireSuccess(response, "move");
      return validateFileListing(await response.json());
    },
    async exportFile(path) {
      const response = await windowRef.fetch(exportEndpointFor(path), {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });
      requireSuccess(response, "export");
      const blob = await response.blob();
      const createObjectURL = windowRef.URL?.createObjectURL?.bind(windowRef.URL);
      const revokeObjectURL = windowRef.URL?.revokeObjectURL?.bind(windowRef.URL);
      if (
        typeof createObjectURL !== "function" ||
        typeof revokeObjectURL !== "function" ||
        !windowRef.document?.body
      ) {
        throw new TypeError("Native file export requires browser download primitives");
      }

      const objectUrl = createObjectURL(blob);
      const anchor = windowRef.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileNameFromPath(path);
      anchor.hidden = true;
      windowRef.document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        windowRef.setTimeout?.(() => revokeObjectURL(objectUrl), 0);
      }
    },
    async createDirectory(path, name) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-directory", path, name }),
      });
      requireSuccess(response, "create-directory");
      return validateFileListing(await response.json());
    },
  };

  assertFileSpacePort(port);
  return Object.freeze(port);
}
