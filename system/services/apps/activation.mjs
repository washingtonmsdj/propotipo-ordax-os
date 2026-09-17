import {
  APP_ACTIVATION_SCHEMA,
  assertAppActivationPort,
  validateAppActivation,
} from "../../contracts/app-activation.mjs";

export function createAppActivationChannel() {
  const listeners = new Set();

  const port = {
    schema: APP_ACTIVATION_SCHEMA,
    publish(value) {
      const activation = validateAppActivation(value);
      for (const listener of [...listeners]) listener(activation);
      return activation;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("App-activation listener must be a function");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  assertAppActivationPort(port);
  return Object.freeze(port);
}
