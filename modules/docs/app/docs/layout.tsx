import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

import { base_options } from "@/lib/layout.shared.tsx";
import { source } from "@/lib/source.ts";

export default function Layout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DocsLayout
      {...base_options()}
      tree={source.getPageTree()}
      sidebar={{
        defaultOpenLevel: 1,
      }}
    >
      {children}
    </DocsLayout>
  );
}
