import type MagicString from "magic-string";

import { HELPERS } from "./constants.ts";
import type { Insertion, MarkupRelocation, Replacement } from "./types.ts";

export function create_source_map(
  magic: MagicString,
  filename: string,
): Record<string, unknown> {
  const map = magic.generateMap({
    hires: true,
    includeContent: true,
    source: filename,
  });

  return map as unknown as Record<string, unknown>;
}

export function blank_script_blocks(content: string): string {
  return content.replace(
    /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,
    (match) => {
      const lines = match.split("\n");
      return lines.map((l) => " ".repeat(l.length)).join("\n");
    },
  );
}

export function inject_helpers(
  magic: MagicString,
  content: string,
): Insertion | undefined {
  if (content.includes(HELPERS.value)) return undefined;

  const helper_block = [
    `import { value as ${HELPERS.value} } from "svelte-effect-runtime/internal/generators";`,
    `import { promise as ${HELPERS.promise} } from "svelte-effect-runtime/internal/generators";`,
    `import { run as ${HELPERS.run} } from "svelte-effect-runtime/internal/generators";`,
  ].join("\n");

  const script_tag = find_instance_script_tag(content);

  if (script_tag) {
    const text = `\n${helper_block}\n`;

    magic.appendLeft(script_tag.end, text);

    return { start: script_tag.end, text };
  } else {
    const text = `<script>\n${helper_block}\n</script>\n\n`;

    magic.prepend(text);

    return { start: 0, text };
  }
}

export function create_relocations(
  replacements: Replacement[],
  helper_insertion: Insertion | undefined,
): MarkupRelocation[] {
  const edits = [
    helper_insertion && {
      start: helper_insertion.start,
      removedLength: 0,
      insertedLength: helper_insertion.text.length,
    },
    ...replacements.map((replacement) => ({
      start: replacement.start,
      removedLength: replacement.end - replacement.start,
      insertedLength: replacement.text.length,
    })),
  ].filter(Boolean) as Array<{
    start: number;
    removedLength: number;
    insertedLength: number;
  }>;

  return replacements.flatMap((replacement) => {
    if (!replacement.relocation) {
      return [];
    }

    const delta_before = edits
      .filter((edit) => edit.start < replacement.start)
      .reduce(
        (total, edit) => total + edit.insertedLength - edit.removedLength,
        0,
      );
    const generated_start = replacement.start + delta_before;

    return [{
      originalStart: replacement.relocation.originalStart,
      originalEnd: replacement.relocation.originalEnd,
      generatedStart: generated_start +
        replacement.relocation.generatedStartInReplacement,
      generatedEnd: generated_start +
        replacement.relocation.generatedEndInReplacement,
    }];
  });
}

function find_instance_script_tag(
  content: string,
): { start: number; end: number } | undefined {
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

  for (const match of content.matchAll(pattern)) {
    if (match.index === undefined) continue;

    const attrs = match[1] ?? "";
    if (
      /\bcontext\s*=\s*["']module["']/.test(attrs) ||
      /\bmodule\b/.test(attrs)
    ) {
      continue;
    }

    const open_end = match[0].indexOf(">") + 1;
    return {
      start: match.index + open_end,
      end: match.index + match[0].length - "</script>".length,
    };
  }

  return undefined;
}
