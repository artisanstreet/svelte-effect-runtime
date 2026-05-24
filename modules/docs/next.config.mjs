import { createMDX } from "fumadocs-mdx/next";

const config = {
  reactStrictMode: true,
};

const with_mdx = createMDX();

export default with_mdx(config);
