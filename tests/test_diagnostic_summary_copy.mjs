import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_SUMMARY_SCHEMA,
  validateDiagnosticSummary,
} from "../system/contracts/diagnostic-copy.mjs";
import { createWebDiagnosticCopy } from "../system/adapters/web/diagnostic-copy.mjs";
import {
  copyDiagnosticReviewSummary,
  copyDiagnosticSummary,
} from "../system/services/diagnostics/copy.mjs";
import { createDiagnosticReviewSummary } from "../system/services/diagnostics/summary.mjs";

function reviewDocument(overrides = {}) {
  const generatedAt = "2026-09-18T23:30:00.000Z";
  const review = {
    schema: "ordax.diagnostic-review/1",
    generatedAt,
    scope: "explicit-local-review",
    manifest: {
      sources: [
        { id: "surface", status: "included", failureCode: "" },
        { id: "update", status: "included", failureCode: "" },
        { id: "metrics", status: "included", failureCode: "" },
        { id: "history", status: "failed", failureCode: "history-read-failed" },
        { id: "journal", status: "included", failureCode: "" },
      ],
      includedSourceIds: ["surface", "update", "metrics", "journal"],
      unavailableSourceIds: [],
      failedSourceIds: ["history"],
      hasFailures: true,
    },
    observations: {
      updateFreshness: {
        state: "stale",
        reason: "age-exceeded",
        ageSeconds: 180,
        maxAgeSeconds: 90,
      },
    },
    report: {
      schema: "ordax.diagnostic-report/2",
      generatedAt,
      scope: "local-reviewable",
      surface: {
        connectivity: "online",
        capabilityIds: ["network.https", "system.metrics"],
      },
      update: {
        deliveryNumber: 42,
        sourceSha: "0123456789abcdef0123456789abcdef01234567",
        runtimeSurfaceSha: "89abcdef0123456789abcdef0123456789abcdef",
        targetSha: null,
        status: "running",
        phase: "idle",
        applyMode: "reload",
        bootRefreshRequired: false,
        checkedAt: "2026-09-18T23:27:00.000Z",
        lastAppliedSha: null,
        lastAppliedAt: "unknown",
        rejectedSha: null,
        lastError: "",
        healthTokenPresent: true,
      },
      metrics: {
        uptimeSeconds: 3600,
        memoryTotalBytes: 8 * 1024 * 1024 * 1024,
        memoryAvailableBytes: 3 * 1024 * 1024 * 1024,
        userStorageTotalBytes: 128 * 1024 * 1024 * 1024,
        userStorageFreeBytes: 80 * 1024 * 1024 * 1024,
      },
      history: null,
      journal: {
        eventCount: 1,
        retentionLimit: 64,
        configuredStoreScope: "device",
        persistenceStatus: "degraded",
        persistenceErrorCode: "save-failed",
        events: [
          {
            $schema: "ordax.diagnostic-event/1",
            eventCode: "update-observation",
            component: "update",
            severity: "warning",
            occurredAt: "2026-09-18T23:29:00.000Z",
            correlationKey: "attempt-42",
            deliveryNumber: 42,
            sourceSha: "0123456789abcdef0123456789abcdef01234567",
            targetSha: "",
            rejectedSha: "",
            status: "running",
            phase: "idle",
            message: "Bearer super-secret-token user@example.com 192.168.1.9 /home/alice/private token=credential-q7z9",
          },
        ],
      },
    },
  };

  return {
    review: {
      ...review,
      ...overrides,
    },
    fileName: "ordax-revisao-diagnostico-2026-09-18.json",
    mediaType: "application/json",
    text: "RAW-DOCUMENT-SECRET password=hunter2 admin@example.com 10.0.0.7 /home/bob/private\n",
  };
}

test("builds a bounded human-readable summary without using serialized document text", () => {
  const summary = createDiagnosticReviewSummary(reviewDocument());

  assert.equal(summary.schema, DIAGNOSTIC_SUMMARY_SCHEMA);
  assert.equal(summary.mediaType, "text/plain;charset=utf-8");
  assert.match(summary.text, /OrdaX — resumo sanitizado de diagnóstico/);
  assert.match(summary.text, /Histórico: falha na leitura \(history-read-failed\)/);
  assert.match(summary.text, /Memória: 5\.0 GB em uso de 8\.0 GB/);
  assert.match(summary.text, /Atualidade da observação: antiga \(180s de idade\)\. Isso não prova falha do supervisor\./);
  assert.match(summary.text, /Persistência: degraded · escopo configurado device · save-failed/);
  assert.match(summary.text, /\[email\]/);
  assert.match(summary.text, /\[ip\]/);
  assert.match(summary.text, /\/home\/\[user\]\/private/);
  assert.match(summary.text, /token=\[redacted\]/);

  for (const secret of [
    "RAW-DOCUMENT-SECRET",
    "hunter2",
    "admin@example.com",
    "10.0.0.7",
    "/home/bob/private",
    "super-secret-token",
    "user@example.com",
    "192.168.1.9",
    "/home/alice/private",
    "credential-q7z9",
  ]) {
    assert.equal(summary.text.includes(secret), false, `summary leaked ${secret}`);
  }
});

test("rejects a manifest that contradicts the structured report", () => {
  const document = reviewDocument();
  document.review.manifest.sources = document.review.manifest.sources.map((entry) =>
    entry.id === "journal"
      ? { id: "journal", status: "unavailable", failureCode: "" }
      : entry,
  );

  assert.throws(() => createDiagnosticReviewSummary(document), TypeError);
});

test("does not convert an unavailable journal into a healthy verdict", () => {
  const document = reviewDocument();
  document.review.manifest.sources = document.review.manifest.sources.map((entry) =>
    entry.id === "journal"
      ? { id: "journal", status: "unavailable", failureCode: "" }
      : entry,
  );
  document.review.report.journal = null;

  const summary = createDiagnosticReviewSummary(document);
  assert.match(summary.text, /Registro diagnóstico: indisponível nesta revisão\./);
  assert.match(summary.text, /A ausência do registro não comprova ausência de problemas\./);
  assert.equal(summary.text.includes("Sistema saudável"), false);
  assert.equal(summary.text.includes("Nenhum problema registrado"), false);
});

test("empty journal remains an observation, not a general health verdict", () => {
  const document = reviewDocument();
  document.review.report.journal = {
    ...document.review.report.journal,
    eventCount: 0,
    persistenceStatus: "device",
    persistenceErrorCode: "",
    events: [],
  };

  const summary = createDiagnosticReviewSummary(document);
  assert.match(summary.text, /Nenhum evento está retido nesta revisão; isso não é um atestado geral de saúde\./);
});

test("Web adapter copies only the validated summary text", async () => {
  const writes = [];
  const adapter = createWebDiagnosticCopy({
    async writeText(value) {
      writes.push(value);
    },
  });
  const document = reviewDocument();
  const expected = createDiagnosticReviewSummary(document);

  const result = await copyDiagnosticReviewSummary(document, adapter);

  assert.deepEqual(result, {
    schema: "ordax.diagnostic-copy-result/1",
    status: "copied",
    code: "",
  });
  assert.deepEqual(writes, [expected.text]);
});

test("copy failure is stable and never propagates adapter exception text", async () => {
  const summary = validateDiagnosticSummary({
    schema: DIAGNOSTIC_SUMMARY_SCHEMA,
    mediaType: "text/plain;charset=utf-8",
    text: "safe summary\n",
  });
  const adapter = createWebDiagnosticCopy({
    async writeText() {
      throw new Error("clipboard denied secret=do-not-leak user@example.com 10.0.0.9");
    },
  });

  const result = await copyDiagnosticSummary(summary, adapter);
  assert.deepEqual(result, {
    schema: "ordax.diagnostic-copy-result/1",
    status: "failed",
    code: "copy-failed",
  });
  assert.equal(JSON.stringify(result).includes("do-not-leak"), false);
  assert.equal(JSON.stringify(result).includes("user@example.com"), false);
});

test("invalid summaries fail before the clipboard adapter is invoked", async () => {
  let calls = 0;
  const adapter = createWebDiagnosticCopy({
    async writeText() {
      calls += 1;
    },
  });

  await assert.rejects(
    copyDiagnosticSummary({
      schema: DIAGNOSTIC_SUMMARY_SCHEMA,
      mediaType: "text/html",
      text: "<b>unsafe</b>",
    }, adapter),
    TypeError,
  );
  assert.equal(calls, 0);
});

test("Web adapter fails closed when clipboard.writeText is unavailable", () => {
  assert.throws(() => createWebDiagnosticCopy(null), TypeError);
  assert.throws(() => createWebDiagnosticCopy({}), TypeError);
});
