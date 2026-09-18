import {
  FILE_SPACE_SCHEMA,
  assertFileSpacePort,
  validateFileListing,
  validateTextFile,
} from "../../contracts/file-space.mjs";

const FILES_ENDPOINT = "/__ordax/native/files";
const FILE_CONTENT_ENDPOINT = "/__ordax/native/file-content";

function endpointFor(path) {
  return `${FILES_ENDPOINT}?path=${encodeURIComponent(path)}`;
}

function contentEndpointFor(path) {
  return `${FILE_CONTENT_ENDPOINT}?path=${encodeURIComponent(path)}`;
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
    if (!response.ok) {
      throw new Error(`Native file-space listing failed: ${response.status}`);
    }
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
      if (!response.ok) {
        throw new Error(`Native text-file read failed: ${response.status}`);
      }
      return validateTextFile(await response.json());
    },
    async createDirectory(path, name) {
      const response = await windowRef.fetch(FILES_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-directory", path, name }),
      });
      if (!response.ok) {
        throw new Error(`Native directory creation failed: ${response.status}`);
      }
      return validateFileListing(await response.json());
    },
  };

  assertFileSpacePort(port);
  return Object.freeze(port);
}
