#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    source = target.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one anchor, found {count}")
    target.write_text(source.replace(old, new), encoding="utf-8")


replace_once(
    "system/surface/ui/notification-center-controls.mjs",
    'import { assertAppActivationPort } from "../../contracts/app-activation.mjs";\nimport { assertNotificationsPort } from "../../contracts/notifications.mjs";\n\nconst SOURCE_LABELS = Object.freeze({\n  files: "Arquivos",\n  settings: "Ajustes",\n  account: "Conta",\n  system: "Sistema",\n  internet: "Internet",\n});\n',
    'import { assertAppActivationPort } from "../../contracts/app-activation.mjs";\nimport { assertNotificationsPort } from "../../contracts/notifications.mjs";\nimport { notificationSourceLabel } from "../../services/notifications/catalog.mjs";\n',
)
replace_once(
    "system/surface/ui/notification-center-controls.mjs",
    '\nfunction sourceLabel(sourceId) {\n  return SOURCE_LABELS[sourceId] ?? sourceId;\n}\n',
    '\n',
)
replace_once(
    "system/surface/ui/notification-center-controls.mjs",
    '  source.textContent = sourceLabel(entry.sourceId);',
    '  source.textContent = notificationSourceLabel(entry.sourceId);',
)
replace_once(
    "system/surface/ui/notification-center-controls.mjs",
    '    const policyPersistence = snapshot.policyPersistence === "device"\n      ? "Não perturbe salvo neste dispositivo"\n      : "Não perturbe vale somente nesta sessão";',
    '    const policyPersistence = snapshot.policyPersistence === "device"\n      ? "Política de notificações salva neste dispositivo"\n      : "Política de notificações vale somente nesta sessão";',
)

replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    'import { assertAppActivationPort } from "../../contracts/app-activation.mjs";\n',
    'import { assertAppActivationPort } from "../../contracts/app-activation.mjs";\nimport { assertNotificationsPort } from "../../contracts/notifications.mjs";\n',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    'import { listPreferenceDefinitions } from "../../services/preferences/catalog.mjs";\n',
    'import { listNotificationSources } from "../../services/notifications/catalog.mjs";\nimport { listPreferenceDefinitions } from "../../services/preferences/catalog.mjs";\n',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '  Object.freeze({ id: "network", label: "Rede" }),\n]);',
    '  Object.freeze({ id: "network", label: "Rede" }),\n  Object.freeze({ id: "notifications", label: "Notificações" }),\n]);',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '  network: Object.freeze({\n    title: "Rede",\n    subtitle: "Conectividade observada e gerenciamento Wi-Fi somente quando o host expõe essa capacidade.",\n  }),\n});',
    '  network: Object.freeze({\n    title: "Rede",\n    subtitle: "Conectividade observada e gerenciamento Wi-Fi somente quando o host expõe essa capacidade.",\n  }),\n  notifications: Object.freeze({\n    title: "Notificações",\n    subtitle: "Apresentação e fontes reais de notificações, sem criar permissões para apps que ainda não publicam eventos.",\n  }),\n});',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '  networkManagement = null,\n  appActivation = null,\n) {',
    '  networkManagement = null,\n  appActivation = null,\n  notifications = null,\n) {',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);\n  const documentObject = root.ownerDocument;\n',
    '  const activationPort = appActivation === null ? null : assertAppActivationPort(appActivation);\n  const notificationPort = notifications === null ? null : assertNotificationsPort(notifications);\n  const documentObject = root.ownerDocument;\n',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '  let networkManagementSnapshot = null;\n',
    '  let networkManagementSnapshot = null;\n  let notificationSnapshot = notificationPort?.getSnapshot() ?? null;\n',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '    if (element.dataset.settingsPreferenceId) {\n',
    '    if (element.dataset.settingsNotificationDnd !== undefined) {\n      return Object.freeze({ kind: "notification-dnd", value: "dnd" });\n    }\n    if (element.dataset.settingsNotificationSource) {\n      return Object.freeze({\n        kind: "notification-source",\n        value: element.dataset.settingsNotificationSource,\n      });\n    }\n    if (element.dataset.settingsPreferenceId) {\n',
)

render_notifications = r'''  const renderNotifications = (view) => {
    const policySection = node(documentObject, "section", "ordax-settings-section");
    policySection.dataset.settingsNotifications = "";
    policySection.append(
      node(documentObject, "span", "ordax-settings-section-kicker", "Apresentação"),
      node(documentObject, "h4", "ordax-settings-section-title", "Não perturbe"),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        "Silencia o sinal de atenção da bandeja sem apagar histórico nem marcar avisos como lidos.",
      ),
    );

    if (!notificationPort || !notificationSnapshot) {
      policySection.append(
        node(
          documentObject,
          "p",
          "ordax-settings-empty",
          "O owner de notificações não está disponível neste ambiente.",
        ),
      );
      view.append(policySection);
      return;
    }

    const dndRow = node(documentObject, "div", "ordax-settings-notification-row");
    const dndCopy = node(documentObject, "span", "ordax-settings-notification-copy");
    dndCopy.append(
      node(
        documentObject,
        "strong",
        "",
        notificationSnapshot.doNotDisturb ? "Não perturbe ativo" : "Avisos de bandeja ativos",
      ),
      node(
        documentObject,
        "small",
        "",
        notificationSnapshot.doNotDisturb
          ? "Novos eventos continuam no histórico, mas badge e cor de atenção ficam ocultos."
          : "Eventos não lidos podem sinalizar atenção na bandeja.",
      ),
    );
    const dndButton = node(
      documentObject,
      "button",
      "ordax-settings-notification-action",
      notificationSnapshot.doNotDisturb ? "Desativar" : "Ativar",
    );
    dndButton.type = "button";
    dndButton.dataset.settingsNotificationDnd = "";
    dndButton.setAttribute("aria-pressed", String(notificationSnapshot.doNotDisturb));
    dndRow.append(dndCopy, dndButton);
    policySection.append(dndRow);

    const sourceSection = node(documentObject, "section", "ordax-settings-section");
    sourceSection.append(
      node(documentObject, "span", "ordax-settings-section-kicker", "Por aplicativo"),
      node(documentObject, "h4", "ordax-settings-section-title", "Fontes que realmente notificam"),
      node(
        documentObject,
        "p",
        "ordax-settings-section-copy",
        "Só aparecem produtores conectados ao serviço comum de notificações. Desativar uma fonte não interrompe a operação correspondente e não apaga o histórico existente.",
      ),
    );

    for (const source of listNotificationSources()) {
      const enabled = !notificationSnapshot.disabledSources.includes(source.id);
      const row = node(documentObject, "div", "ordax-settings-notification-row");
      row.dataset.enabled = String(enabled);
      const copy = node(documentObject, "span", "ordax-settings-notification-copy");
      copy.append(
        node(documentObject, "strong", "", `${source.label} · ${source.topic}`),
        node(documentObject, "small", "", source.description),
      );
      const action = node(
        documentObject,
        "button",
        "ordax-settings-notification-action",
        enabled ? "Desativar" : "Ativar",
      );
      action.type = "button";
      action.dataset.settingsNotificationSource = source.id;
      action.setAttribute("aria-pressed", String(enabled));
      row.append(copy, action);
      sourceSection.append(row);
    }

    sourceSection.append(
      node(
        documentObject,
        "p",
        "ordax-settings-notification-persistence",
        notificationSnapshot.policyPersistence === "device"
          ? "Preferências de notificações salvas neste dispositivo."
          : "Preferências de notificações válidas somente nesta sessão.",
      ),
    );
    view.append(policySection, sourceSection);
  };

'''
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '  const renderNetworkManagement = (section) => {\n',
    render_notifications + '  const renderNetworkManagement = (section) => {\n',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '    } else if (activeSection === "network") {\n      renderNetwork(view);\n    }\n',
    '    } else if (activeSection === "network") {\n      renderNetwork(view);\n    } else if (activeSection === "notifications") {\n      renderNotifications(view);\n    }\n',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '    const preferenceButton = event.target.closest("[data-settings-preference-id]");\n',
    '    const dndButton = event.target.closest("[data-settings-notification-dnd]");\n    if (dndButton && root.contains(dndButton) && notificationPort && notificationSnapshot) {\n      notificationPort.setDoNotDisturb(!notificationSnapshot.doNotDisturb);\n      return;\n    }\n\n    const notificationSourceButton = event.target.closest("[data-settings-notification-source]");\n    if (\n      notificationSourceButton\n      && root.contains(notificationSourceButton)\n      && notificationPort\n      && notificationSnapshot\n    ) {\n      const sourceId = notificationSourceButton.dataset.settingsNotificationSource;\n      const enabled = !notificationSnapshot.disabledSources.includes(sourceId);\n      notificationPort.setSourceEnabled(sourceId, !enabled);\n      return;\n    }\n\n    const preferenceButton = event.target.closest("[data-settings-preference-id]");\n',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '  const unsubscribePreferences = preferences.subscribe((snapshot) => {\n    preferenceSnapshot = snapshot;\n    replaceView();\n  });\n',
    '  const unsubscribePreferences = preferences.subscribe((snapshot) => {\n    preferenceSnapshot = snapshot;\n    replaceView();\n  });\n  const unsubscribeNotifications = notificationPort?.subscribe((snapshot) => {\n    notificationSnapshot = snapshot;\n    if (activeSection === "notifications") replaceView();\n  });\n',
)
replace_once(
    "system/surface/ui/settings-overview-controls.mjs",
    '      unsubscribePreferences?.();\n',
    '      unsubscribeNotifications?.();\n      unsubscribePreferences?.();\n',
)

replace_once(
    "system/composition/web/main.mjs",
    '  null,\n  null,\n  appActivation,\n);\nconst systemOverviewControls',
    '  null,\n  null,\n  appActivation,\n  notifications,\n);\nconst systemOverviewControls',
)
replace_once(
    "system/composition/native/main.mjs",
    '      networkStatus,\n      networkManagement,\n      appActivation,\n    );',
    '      networkStatus,\n      networkManagement,\n      appActivation,\n      notifications,\n    );',
)
replace_once(
    "system/composition/native/main.mjs",
    '      networkStatus,\n      null,\n      appActivation,\n    );',
    '      networkStatus,\n      null,\n      appActivation,\n      notifications,\n    );',
)

css_addition = r'''
.ordax-settings-notification-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--ordax-border-soft);
  border-radius: var(--ordax-radius-sm);
  background: var(--ordax-subtle-bg);
}

.ordax-settings-notification-copy {
  min-width: 0;
}

.ordax-settings-notification-copy strong,
.ordax-settings-notification-copy small {
  display: block;
}

.ordax-settings-notification-copy strong {
  font-size: 0.82rem;
}

.ordax-settings-notification-copy small,
.ordax-settings-notification-persistence {
  color: var(--ordax-muted);
  font-size: 0.7rem;
  line-height: 1.45;
}

.ordax-settings-notification-copy small {
  margin-top: 4px;
}

.ordax-settings-notification-action {
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid var(--ordax-border);
  border-radius: var(--ordax-radius-sm);
  background: transparent;
  color: var(--ordax-text);
  cursor: pointer;
  font: inherit;
  font-size: 0.7rem;
  font-weight: 650;
}

.ordax-settings-notification-action:hover,
.ordax-settings-notification-action:focus-visible {
  background: var(--ordax-hover-bg);
  outline: 2px solid var(--ordax-focus);
  outline-offset: 1px;
}

.ordax-settings-notification-action[aria-pressed="true"] {
  border-color: var(--ordax-accent);
}

.ordax-settings-notification-persistence {
  margin: 12px 0 0;
}

'''
replace_once(
    "system/surface/ui/settings.css",
    '.ordax-settings-network-service,\n.ordax-settings-network-item {\n',
    css_addition + '.ordax-settings-network-service,\n.ordax-settings-network-item {\n',
)

replace_once(
    "PLANO-FUNCIONAL-SURFACE-E-APPS.md",
    '**Estado:** PARCIAL/P1-P2. A central local comum já existe via `ordax.notifications/1`, com histórico limitado, origem, horário, nível, ação, estado lido/dispensado e persistência Native com fallback explícito para sessão. `Não perturbe` já controla a apresentação que existe hoje: silencia badge/cor de atenção da bandeja sem apagar histórico nem estado não lido; no Native a política é persistida pelo owner de notificações via `ordax.notification-store/2`, enquanto o Web permanece somente na sessão. Atualizações é hoje o único produtor integrado à central. Som, ativação global, preferências/permissões por app, eventos de outros owners e política de consentimento/retenção continuam NOVO/P2. A existência de telemetria técnica atual não prova que já há controles de consentimento, retenção ou preferência de coleta na UI.',
    '**Estado:** PARCIAL/P1-P2. A central local comum existe via `ordax.notifications/2`, com histórico limitado, origem, horário, nível, ação, estado lido/dispensado e persistência Native com fallback explícito para sessão. `Não perturbe` controla a apresentação que existe hoje: silencia badge/cor de atenção da bandeja sem apagar histórico nem estado não lido. A política Native usa `ordax.notification-store/3`, enquanto o Web permanece somente na sessão. **Ajustes → Notificações** é o editor canônico dessa mesma política e lista somente fontes reais registradas; hoje `Sistema → Atualizações` (`system-updates`) é o único produtor integrado e pode ser desativado sem interromper o atualizador nem apagar histórico anterior. Som, ativação global, eventos de outros owners, permissões locais de host e política de consentimento/retenção continuam NOVO/P2. A existência de telemetria técnica atual não prova que já há controles de consentimento, retenção ou preferência de coleta na UI.',
)
replace_once(
    "PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md",
    '**Notificações:** central pequena com origem, horário, nível, ação e estado lido/dispensado. Eventos reais de cópia, sync, atualização e dispositivo. Não converter todo heartbeat em aviso. “Não perturbe” controla apresentação conforme política; falha crítica continua consultável no owner. **Estado atual do recorte:** PARCIAL. A central local comum e o Não Perturbe de bandeja já foram implementados no protótipo; hoje apenas Atualizações está integrado como produtor real. Cópia, sync e dispositivo só devem publicar quando seus próprios owners expuserem transições reais e úteis, sem criar produtores paralelos. Som, ativação global e preferências/permissões por app continuam pendentes.',
    '**Notificações:** central pequena com origem, horário, nível, ação e estado lido/dispensado. Eventos reais de cópia, sync, atualização e dispositivo. Não converter todo heartbeat em aviso. “Não perturbe” controla apresentação conforme política; falha crítica continua consultável no owner. **Estado atual do recorte:** PARCIAL. A central local comum, o Não Perturbe de bandeja e o editor canônico **Ajustes → Notificações** já foram implementados. Hoje apenas `Sistema → Atualizações` está registrado como produtor real (`system-updates`) e sua preferência pode impedir novos avisos sem interromper o atualizador nem apagar histórico anterior. Cópia, sync e dispositivo só devem publicar quando seus próprios owners expuserem transições reais e úteis, sem criar produtores paralelos. Som, ativação global, permissões de host e preferências de futuros produtores continuam pendentes.',
)
