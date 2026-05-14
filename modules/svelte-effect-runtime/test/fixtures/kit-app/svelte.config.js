import adapter from "@sveltejs/adapter-static";
import { fileURLToPath, URL } from "node:url";
import { effectPreprocess } from "../../../.dist/preprocess.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/** @type {import("@sveltejs/kit").Config} */
const config = {
  preprocess: [
    effectPreprocess({
      runtimeModuleId: "ser/client",
    }),
  ],
  kit: {
    adapter: adapter(),
    alias: {
      ser: repoRoot,
    },
    experimental: {
      remoteFunctions: true,
    },
  },
};

export default config;
