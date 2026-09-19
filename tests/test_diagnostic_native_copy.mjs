import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAGNOSTIC_SUMMARY_SCHEMA,
  validateDiagnosticSummary,
} from "../system/contracts/diagnostic-copy.mjs";
import { createNativeDiagnosticCopy } from "../system/adapters/native/diagnostic-copy.mjs";

function summary(text = "OrdaX diagnostic summary\n") {
  return validateDiagnosticSummary({
    schema: DIAGNOSTIC_SUMMARY_SCHEMA,
    mediaType: "text/plain;charset=utf-8",
    text,
  });
}

test("Native diagnostic copy writes exactly the validated summary text", async () => {
  const writes = [];
  const adapter = createNativeDiagnosticCopy({
    async writeText(value) {
      writes.push(value);
    },
  });
  const value = summary();

  assert.deepEqual(await adapter.copy(value), { status: "copied" });
  assert.deepEqual(writes, [value.text]);
});

test("Native diagnostic copy rejects invalid summaries before clipboard access", async () => {
  let calls = 0;
  const adapter = createNativeDiagnosticCopy({
    async writeText() {
      calls += 1;
    },
  });

  await assert.rejects(
    adapter.copy({
      schema: DIAGNOSTIC_SUMMARY_SCHEMA,
      mediaType: "application/json",
      text: "{}\n",
    }),
    TypeError,
  );
  assert.equal(calls, 0);
});

test("Native diagnostic copy propagates host denial for the shared service to normalize", async () => {
  const adapter = createNativeDiagnosticCopy({
    async writeText() {
      throw new Error("clipboard denied token=do-not-leak");
    },
  });

  await assert.rejects(adapter.copy(summary()), /do-not-leak/);
});

test("Native diagnostic copy requires an explicit compatible clipboard capability", () => {
  assert.throws(() => createNativeDiagnosticCopy(null), TypeError);
  assert.throws(() => createNativeDiagnosticCopy({}), TypeError);
  assert.throws(() => createNativeDiagnosticCopy({ writeText: "no" }), TypeError);
});
