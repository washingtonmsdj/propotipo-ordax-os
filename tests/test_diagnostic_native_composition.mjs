import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const COMPOSITION_PATH = new URL(
  "../system/composition/native/main.mjs",
  import.meta.url,
);

async function compositionSource() {
  return readFile(COMPOSITION_PATH, "utf8");
}

test("Native composition wires the diagnostic journal through neutral layers", async () => {
  const source = await compositionSource();

  assert.match(source, /createNativeDiagnosticJournalStore/);
  assert.match(source, /createDiagnosticJournalRuntime/);
  assert.match(source, /createUpdateDiagnosticRecorder/);
  assert.match(
    source,
    /const diagnosticJournal = await createDiagnosticJournalRuntime\(\{\s*store: diagnosticJournalStore,?\s*\}\);/,
  );
  assert.match(
    source,
    /createUpdateDiagnosticRecorder\(updateWatcher, diagnosticJournal\)/,
  );
});

test("Native composition keeps persistence mechanics inside the adapter", async () => {
  const source = await compositionSource();

  assert.doesNotMatch(source, /\/__ordax\/native\/diagnostic-journal/);
  assert.doesNotMatch(source, /diagnostic-journal\.json/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test("Native composition disposes the recorder before the update watcher", async () => {
  const source = await compositionSource();
  const recorderDispose = source.indexOf("updateDiagnosticRecorder.dispose()");
  const watcherDispose = source.indexOf("updateWatcher.dispose()");

  assert.notEqual(recorderDispose, -1);
  assert.notEqual(watcherDispose, -1);
  assert.ok(recorderDispose < watcherDispose);
});
