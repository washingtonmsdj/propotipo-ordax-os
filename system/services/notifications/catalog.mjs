import { validateNotificationSourceId } from "../../contracts/notifications.mjs";

export const SYSTEM_UPDATES_NOTIFICATION_SOURCE_ID = "system-updates";

const SOURCES = Object.freeze([
  Object.freeze({
    id: SYSTEM_UPDATES_NOTIFICATION_SOURCE_ID,
    appId: "system",
    label: "Sistema",
    topic: "Atualizações",
    description: "Avisos de atualização aplicada, falha, rollback e atualização de base pendente.",
  }),
]);

const LEGACY_SOURCE_LABELS = Object.freeze({
  files: "Arquivos",
  settings: "Ajustes",
  account: "Conta",
  system: "Sistema",
  internet: "Internet",
});

for (const source of SOURCES) validateNotificationSourceId(source.id);

export function listNotificationSources() {
  return SOURCES;
}

export function notificationSourceLabel(sourceId) {
  const source = SOURCES.find((candidate) => candidate.id === sourceId);
  if (source) return `${source.label} · ${source.topic}`;
  return LEGACY_SOURCE_LABELS[sourceId] ?? sourceId;
}
