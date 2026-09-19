import assert from "node:assert/strict";
import test from "node:test";

import { createHomeContinuationPresentation } from "../system/surface/ui/home-continuation.mjs";
import { createHomePendingPresentation } from "../system/surface/ui/home-pending.mjs";

function projects(overrides = {}) {
  return {
    persistence: "device",
    projects: [
      {
        id: "project-1",
        name: "OrdaX",
        path: "/Documentos/OrdaX",
        createdAt: 100,
        lastOpenedAt: 300,
      },
      {
        id: "project-2",
        name: "Modelos 3D",
        path: "/Documentos/Modelos",
        createdAt: 100,
        lastOpenedAt: 500,
      },
      {
        id: "project-3",
        name: "Arquivo antigo",
        path: "/Documentos/Antigo",
        createdAt: 50,
        lastOpenedAt: 200,
      },
    ],
    ...overrides,
  };
}

function recentFiles(overrides = {}) {
  return {
    persistence: "device",
    entries: [
      {
        path: "/Documentos/OrdaX/notas.md",
        name: "notas.md",
        openedAt: 700,
      },
      {
        path: "/Downloads/referencia.txt",
        name: "referencia.txt",
        openedAt: 600,
      },
      {
        path: "/Imagens/antiga.png",
        name: "antiga.png",
        openedAt: 100,
      },
    ],
    ...overrides,
  };
}

function notifications(overrides = {}) {
  return {
    persistence: "device",
    policyPersistence: "device",
    doNotDisturb: false,
    disabledSources: [],
    entries: [
      {
        id: "notification-2",
        sourceId: "system-updates",
        level: "warning",
        title: "Atualização requer atenção",
        message: "Uma atualização aguarda ação local.",
        destination: null,
        createdAt: 200,
        read: false,
      },
      {
        id: "notification-1",
        sourceId: "system-updates",
        level: "success",
        title: "Atualização aplicada",
        message: "A atualização anterior foi aplicada.",
        destination: null,
        createdAt: 100,
        read: true,
      },
    ],
    ...overrides,
  };
}

function syncRuntime(overrides = {}) {
  return {
    transport: "host-required",
    accountContinuity: "not-active",
    pendingMutationCount: 1,
    queuePersistence: "device",
    trackedDataClasses: ["appearance"],
    ...overrides,
  };
}

test("Home continuation presents two recent projects and two recent files without inventing file open support", () => {
  const presentation = createHomeContinuationPresentation({
    projects: projects(),
    recentFiles: recentFiles(),
  });

  assert.equal(presentation.visible, true);
  assert.equal(presentation.items.length, 4);
  assert.deepEqual(
    presentation.items.map((item) => [item.kind, item.title, item.target]),
    [
      ["project", "Modelos 3D", "/Documentos/Modelos"],
      ["project", "OrdaX", "/Documentos/OrdaX"],
      ["recent-file", "notas.md", "/Documentos/OrdaX"],
      ["recent-file", "referencia.txt", "/Downloads"],
    ],
  );
  assert.match(presentation.items[2].actionLabel, /^Mostrar notas\.md em Arquivos$/);
  assert.ok(Object.isFrozen(presentation));
  assert.ok(Object.isFrozen(presentation.items));
});

test("Home continuation stays absent on first use instead of rendering an empty dashboard card", () => {
  const presentation = createHomeContinuationPresentation({
    projects: { persistence: "device", projects: [] },
    recentFiles: { persistence: "device", entries: [] },
  });

  assert.deepEqual(presentation, {
    visible: false,
    items: [],
  });
});

test("session-only sources remain explicit in Home metadata", () => {
  const presentation = createHomeContinuationPresentation({
    projects: projects({ persistence: "session" }),
    recentFiles: recentFiles({ persistence: "session" }),
  });

  for (const item of presentation.items) {
    assert.match(item.detail, /somente nesta sessão/);
  }
});

test("Home continuation validates owner snapshots instead of accepting malformed context", () => {
  assert.throws(
    () => createHomeContinuationPresentation({
      projects: { persistence: "device", projects: [{ id: "bad" }] },
    }),
    TypeError,
  );
  assert.throws(
    () => createHomeContinuationPresentation({
      recentFiles: {
        persistence: "device",
        entries: [{ path: "/x.txt", name: "wrong.txt", openedAt: 1 }],
      },
    }),
    TypeError,
  );
});

test("Home pending summary aggregates only real unread notifications and queued local sync mutations", () => {
  const presentation = createHomePendingPresentation({
    notifications: notifications(),
    syncRuntime: syncRuntime(),
  });

  assert.equal(presentation.visible, true);
  assert.deepEqual(
    presentation.items.map((item) => [item.kind, item.title, item.actionKind, item.appId, item.target]),
    [
      ["notifications", "1 notificação não lida", "quick-panel", null, null],
      ["sync", "1 alteração local pendente", "app", "account", "sync"],
    ],
  );
  assert.equal(presentation.items[0].panel, "notifications");
  assert.match(presentation.items[1].detail, /transporte remoto não está ativo/);
  assert.ok(Object.isFrozen(presentation));
  assert.ok(Object.isFrozen(presentation.items));
});

test("Home pending summary disappears when there is no real attention state", () => {
  const presentation = createHomePendingPresentation({
    notifications: notifications({ entries: [] }),
    syncRuntime: syncRuntime({ pendingMutationCount: 0 }),
  });

  assert.deepEqual(presentation, {
    visible: false,
    items: [],
  });
});

test("Home pending summary is explicit about muted attention and session-only queues", () => {
  const presentation = createHomePendingPresentation({
    notifications: notifications({
      persistence: "session",
      doNotDisturb: true,
    }),
    syncRuntime: syncRuntime({ queuePersistence: "session" }),
  });

  assert.match(presentation.items[0].detail, /Não perturbe ativo/);
  assert.match(presentation.items[0].detail, /histórico somente nesta sessão/);
  assert.match(presentation.items[1].detail, /continuidade de conta não está ativa/);
  assert.match(presentation.items[1].detail, /fila somente nesta sessão/);
});

test("Home pending summary validates canonical owner snapshots", () => {
  assert.throws(
    () => createHomePendingPresentation({
      notifications: { persistence: "device", entries: [] },
    }),
    TypeError,
  );
  assert.throws(
    () => createHomePendingPresentation({
      syncRuntime: syncRuntime({ pendingMutationCount: -1 }),
    }),
    TypeError,
  );
});
