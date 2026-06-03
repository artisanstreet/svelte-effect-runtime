import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function base_options(): BaseLayoutProps {
  return {
    nav: {
      title: "svelte-effect-runtime",
    },
    links: [
      {
        text: "GitHub",
        url: "https://github.com/usebarekey/svelte-effect-runtime",
      },
      {
        text: "npm",
        url: "https://www.npmjs.com/package/svelte-effect-runtime",
      },
      {
        text: "JSR",
        url: "https://jsr.io/@barekey/svelte-effect-runtime",
      },
    ],
  };
}
