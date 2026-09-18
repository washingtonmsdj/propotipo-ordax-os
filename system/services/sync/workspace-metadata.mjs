import {
  WORKSPACE_METADATA_SCHEMA,
  WORKSPACE_METADATA_SOURCE_SCHEMA,
  assertWorkspaceMetadataSource,
  validateWorkspaceMetadata,
} from "../../contracts/workspace-metadata-source.mjs";
import {
  WORKSPACE_STORE_SCHEMA,
  assertWorkspaceStore,
  validateWorkspaceRecord,
} from "../../contracts/workspace-store.mjs";

export function createWorkspaceMetadata(workspaceRecord) {
  const workspace = validateWorkspaceRecord(workspaceRecord);
  return validateWorkspaceMetadata({
    $schema: WORKSPACE_METADATA_SCHEMA,
    activeAreaId: workspace.activeAreaId,
    areas: workspace.areas.map((area) => ({
      id: area.id,
      ordinal: area.ordinal,
      appIds: area.windows.map((windowState) => windowState.appId),
    })),
  });
}

function metadataFingerprint(snapshot) {
  return JSON.stringify(snapshot);
}

export function createWorkspaceMetadataBridge(workspaceStore) {
  const baseStore = assertWorkspaceStore(workspaceStore);
  let workspace = baseStore.load();
  let snapshot = createWorkspaceMetadata(workspace);
  let fingerprint = metadataFingerprint(snapshot);
  const listeners = new Set();

  const update = (workspaceRecord) => {
    workspace = validateWorkspaceRecord(workspaceRecord);
    const next = createWorkspaceMetadata(workspace);
    const nextFingerprint = metadataFingerprint(next);
    if (nextFingerprint === fingerprint) return;
    snapshot = next;
    fingerprint = nextFingerprint;
    for (const listener of [...listeners]) listener(snapshot);
  };

  const store = Object.freeze({
    schema: WORKSPACE_STORE_SCHEMA,
    load() {
      const loaded = baseStore.load();
      update(loaded);
      return loaded;
    },
    save(workspaceRecord) {
      const validated = validateWorkspaceRecord(workspaceRecord);
      const saved = baseStore.save(validated);
      update(validated);
      return saved;
    },
  });

  const source = Object.freeze({
    schema: WORKSPACE_METADATA_SOURCE_SCHEMA,
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("Workspace metadata listener must be a function");
      }
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  });

  assertWorkspaceStore(store);
  assertWorkspaceMetadataSource(source);
  return Object.freeze({ store, source });
}
