import { assertNetworkManagementPort } from "../../contracts/network-management.mjs";

const ACTIONS = new Set(["scan", "connect", "disconnect", "forget", "reconnect"]);

export function networkManagementActionMessage(action, state) {
  const labels = {
    scan: ["Procurando redes Wi-Fi…", "Redes Wi-Fi atualizadas."],
    connect: ["Conectando ao Wi-Fi…", "Wi-Fi conectado."],
    disconnect: ["Desconectando do Wi-Fi…", "Wi-Fi desconectado."],
    forget: ["Esquecendo a rede salva…", "Rede Wi-Fi esquecida."],
    reconnect: ["Reconectando ao Wi-Fi salvo…", "Wi-Fi reconectado."],
  };
  if (!ACTIONS.has(action)) throw new TypeError("Ação de Wi-Fi inválida");
  return labels[action][state === 1 ? 1 : 0];
}

export function networkManagementFailureMessage(action, error) {
  if (!ACTIONS.has(action)) throw new TypeError("Ação de Wi-Fi inválida");
  if (error?.status === 409 && action === "connect") {
    return "Não foi possível conectar. Confira a senha e se a rede ainda está disponível.";
  }
  if (error?.status === 409 && action === "reconnect") {
    return "A rede salva não pôde ser reconectada. A configuração salva foi preservada.";
  }
  if (error instanceof TypeError) {
    return "SSID ou senha fora dos limites aceitos para esta rede Wi-Fi.";
  }
  return "A ação de Wi-Fi não pôde ser concluída. A rede anterior foi preservada quando aplicável.";
}

export async function runNetworkManagementAction(port, action, credentials = null) {
  const management = assertNetworkManagementPort(port);
  if (!ACTIONS.has(action)) throw new TypeError("Ação de Wi-Fi inválida");
  switch (action) {
    case "scan":
      return management.scan();
    case "connect":
      return management.connect(credentials);
    case "disconnect":
      return management.disconnect();
    case "forget":
      return management.forget();
    case "reconnect":
      return management.reconnect();
    default:
      throw new TypeError("Ação de Wi-Fi inválida");
  }
}
