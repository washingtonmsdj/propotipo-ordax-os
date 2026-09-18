const UPDATE_LABELS = Object.freeze({
  running: "Em execução",
  applied: "Atualização aplicada",
  updating: "Atualizando",
  "network-error": "Sem conexão para atualizar",
  "remote-error": "Fonte de atualização indisponível",
  "pull-error": "Falha ao atualizar",
  "rolled-back": "Atualização revertida",
  rejected: "Entrega bloqueada",
  pinned: "Entrega fixada",
  disabled: "Atualização indisponível",
  unavailable: "Estado indisponível",
});

export function updateStatusLabel(status) {
  return UPDATE_LABELS[status] ?? String(status || "Estado indisponível");
}

export function updateIsAlerting(snapshot) {
  return Boolean(snapshot?.bootRefreshRequired) || [
    "network-error",
    "remote-error",
    "pull-error",
    "rolled-back",
    "rejected",
  ].includes(snapshot?.status);
}

export function shortSha(value) {
  if (typeof value !== "string" || value.length < 8 || value === "unavailable") return "—";
  return value.slice(0, 8);
}

export function deliveryLabel(value) {
  return Number.isSafeInteger(value) && value > 0 ? `Entrega ${value}` : "Entrega sem número";
}

export function formatUpdateTimestamp(value) {
  if (typeof value !== "string" || !value || value === "unknown") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Bahia",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function readableUpdateMode(mode) {
  switch (mode) {
    case "reload": return "Recarga rápida da Surface";
    case "surface-restart": return "Reinício somente da Surface";
    case "supervisor-restart": return "Reinício do supervisor";
    case "initial": return "Inicialização";
    default: return "Sem ação pendente";
  }
}

export function readableUpdatePhase(phase) {
  switch (phase) {
    case "checking": return "Verificando atualizações";
    case "fetching": return "Baixando entrega";
    case "validating": return "Validando sistema";
    case "activating": return "Ativando entrega";
    case "health-wait": return "Aguardando confirmação de saúde";
    case "rollback": return "Revertendo automaticamente";
    case "blocked": return "Bloqueada";
    case "error": return "Falha";
    default: return "Em repouso";
  }
}

export function updateSummaryLabel(snapshot) {
  return snapshot?.bootRefreshRequired
    ? "Atualização de base pendente"
    : updateStatusLabel(snapshot?.status);
}

export function updateSummaryDetail(snapshot) {
  if (!snapshot?.bootRefreshRequired) return "";
  return "Reiniciar manualmente agora não conclui esta atualização; a ativação e o reinício serão conduzidos automaticamente quando a base estiver preparada.";
}

export function updateBootLabel(snapshot) {
  return snapshot?.bootRefreshRequired
    ? "Base pendente de ativação"
    : "Nenhuma atualização de base pendente";
}

export function updateAttentionMessage(snapshot) {
  if (snapshot?.bootRefreshRequired) {
    return "Existe uma atualização de boot/kernel pendente. Reiniciar manualmente agora, sozinho, não aplica esses bytes; o OrdaX fará a ativação e solicitará o reinício automaticamente quando a base estiver preparada.";
  }
  return "A entrega atual permanece preservada enquanto o atualizador tenta recuperar um estado saudável.";
}
