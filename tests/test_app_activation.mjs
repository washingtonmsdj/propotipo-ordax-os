import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_ACTIVATION_SCHEMA,
  validateAppActivation,
} from "../system/contracts/app-activation.mjs";
import { createAppActivationChannel } from "../system/services/apps/activation.mjs";

test("app activation validates a bounded neutral target", () => {
  assert.deepEqual(
    validateAppActivation({ appId: "files", target: "/Documentos" }),
    { appId: "files", target: "/Documentos" },
  );
  assert.throws(() => validateAppActivation({ appId: "../files", target: "/" }), TypeError);
  assert.throws(() => validateAppActivation({ appId: "files", target: "bad\npath" }), TypeError);
});

test("activation channel publishes immutable app intent and supports unsubscribe", () => {
  const channel = createAppActivationChannel();
  assert.equal(channel.schema, APP_ACTIVATION_SCHEMA);
  const received = [];
  const unsubscribe = channel.subscribe((activation) => received.push(activation));
  const activation = channel.publish({ appId: "files", target: "/Imagens" });
  assert.equal(Object.isFrozen(activation), true);
  assert.deepEqual(received, [{ appId: "files", target: "/Imagens" }]);
  unsubscribe();
  channel.publish({ appId: "files", target: "/Downloads" });
  assert.equal(received.length, 1);
});
