import {
  FILE_SPACE_SCHEMA,
  assertFileSpacePort,
} from "../../contracts/file-space.mjs";
import { assertProjectCatalogPort } from "../../contracts/project-catalog.mjs";

function joinPath(path, name) {
  return path === "/" ? `/${name}` : `${path}/${name}`;
}

function reportContinuityError(callback, error) {
  if (!callback) return;
  try {
    callback(error);
  } catch {
    // Diagnostics must never turn an already-completed file operation into a failure.
  }
}

export function createProjectContinuityFileSpace(
  fileSpace,
  projects = null,
  { onContinuityError = null } = {},
) {
  const filePort = assertFileSpacePort(fileSpace);
  const projectPort = projects === null ? null : assertProjectCatalogPort(projects);
  if (onContinuityError !== null && typeof onContinuityError !== "function") {
    throw new TypeError("Project continuity file-space error reporter must be a function");
  }
  if (!projectPort) return filePort;

  const relocate = (previousPath, nextPath) => {
    try {
      projectPort.relocateLastFilePath(previousPath, nextPath);
    } catch (error) {
      reportContinuityError(onContinuityError, error);
    }
  };

  const port = {
    schema: FILE_SPACE_SCHEMA,
    list(...args) {
      return filePort.list(...args);
    },
    createDirectory(...args) {
      return filePort.createDirectory(...args);
    },
    readTextFile(...args) {
      return filePort.readTextFile(...args);
    },
    async renameEntry(path, name, newName) {
      const result = await filePort.renameEntry(path, name, newName);
      relocate(joinPath(path, name), joinPath(path, newName));
      return result;
    },
    copyFile(...args) {
      return filePort.copyFile(...args);
    },
    async moveEntry(sourcePath, name, destinationPath) {
      const result = await filePort.moveEntry(sourcePath, name, destinationPath);
      relocate(joinPath(sourcePath, name), joinPath(destinationPath, name));
      return result;
    },
    exportFile(...args) {
      return filePort.exportFile(...args);
    },
    importFile(...args) {
      return filePort.importFile(...args);
    },
  };

  assertFileSpacePort(port);
  return Object.freeze(port);
}
