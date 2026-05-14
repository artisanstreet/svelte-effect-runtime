import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { svelteEffectRuntime } from "../../../.dist/vite.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixtureRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fixtureRoot,
  plugins: [
    svelteEffectRuntime({
      effect: {
        runtimeModuleId: "ser/client",
      },
    }),
  ],
  resolve: {
    alias: {
      ser: repoRoot,
    },
  },
});
