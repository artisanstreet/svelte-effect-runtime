import { createMDX } from "fumadocs-mdx/next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const docs_dir = dirname(fileURLToPath(import.meta.url));
const config = {
  reactStrictMode: true,
  turbopack: {
    root: docs_dir,
  },
};

const with_mdx = createMDX();

export default with_mdx(config);
