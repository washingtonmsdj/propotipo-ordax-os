import { assertNotificationsPort } from "../../contracts/notifications.mjs";
import { assertUpdateStatusPort } from "../../contracts/update-status.mjs";
import {
  deliveryLabel,
  updateStatusLabel,
  updateSummaryDetail,
} from "../update/presentation.mjs";

const DESTINATION = Object.freeze({ appId: "system", target: "updates" });

function eventSignature(snapshot) {
  if (snapshot === null) return "null";
  return JSON.stringify([
    snapshot.status,
    snapshot.phase,
    snapshot.attemptId,
    snapshot.targetSha,
    snapshot.lastAppliedSha,
    snapshot.rejectedSha,
    snapshot.bootRefreshRequired,
  ]);
}

function actionableNotification(previous, current) {
  if (current === null) return null;

  if (current.bootRefreshRequired && previous?.bootRefreshRequired !== true) {
    return {
      sourceId: "system",
      level: "warning",
      title: "Atualização de base pendente",
      message: updateSummaryDetail(current),
      destination: DESTINATION,
    };
  }

  switch (current.status) {
    case "applied":
      return {
        sourceId: "system",
        level: "success",
        title: "Atualização aplicada",
        message: `${deliveryLabel(current.deliveryNumber)} foi aplicada e confirmada pelo atualizador.`,
        destination: DESTINATION,
      };
    case "network-error":
      return {
        sourceId: "system",
        level: "warning",
        title: updateStatusLabel(current.status),
        message: "A origem de atualização não pôde ser consultada. A entrega atual continua em uso.",
        destination: DESTINATION,
      };
    case "remote-error":
      return {
        sourceId: "system",
        level: "warning",
        title: updateStatusLabel(current.status),
        message: "A fonte remota ficou indisponível. A entrega atual continua preservada.",
        destination: DESTINATION,
      };
    case "pull-error":
      return {
        sourceId: "system",
        level: "error",
        title: updateStatusLabel(current.status),
        message: "A tentativa de atualização falhou antes de substituir a entrega funcional.",
        destination: DESTINATION,
      };
    case "rejected":
      return {
        sourceId: "system",
        level: "warning",
        title: updateStatusLabel(current.status),
        message: "A entrega candidata foi bloqueada antes da ativação e a versão atual foi preservada.",
        destination: DESTINATION,
      };
    case "rolled-back":
      return {
        sourceId: "system",
        level: "warning",
        title: updateStatusLabel(current.status),
        message: "A tentativa foi revertida e a entrega conhecida foi restaurada.",
        destination: DESTINATION,
      };
    default:
      return null;
  }
}

export function createUpdateNotificationBridge(updateStatus, notifications) {
  const source = assertUpdateStatusPort(updateStatus);
  const center = assertNotificationsPort(notifications);
  let previous = source.getSnapshot();
  let previousSignature = eventSignature(previous);

  const unsubscribe = source.subscribe((current) => {
    const signature = eventSignature(current);
    if (signature === previousSignature) return;
    const notification = actionableNotification(previous, current);
    previous = current;
    previousSignature = signature;
    if (notification) center.publish(notification);
  });

  return Object.freeze({
    destroy() {
      unsubscribe();
    },
  });
}
