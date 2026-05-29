import { HELPERS } from "./constants.ts";
import {
  collect_free_identifiers,
  strip_arrow_function,
} from "./expressions.ts";
import type {
  MarkupCandidate,
  PendingRelocation,
  Replacement,
  TagKind,
} from "./types.ts";

/**
 * Emits source edits for classified markup Effect expressions.
 *
 * @since 2.0.0
 * @param classified - Candidates paired with their Svelte markup context.
 * @returns Replacements ready to apply to the original component source.
 */
export function emit_replacements(
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
): Replacement[] {
  return classified.map(({ candidate, kind }) =>
    emit_replacement(candidate, kind)
  );
}

function emit_replacement(
  candidate: MarkupCandidate,
  kind: TagKind,
): Replacement {
  const id = make_cache_id(candidate);
  const id_text = JSON.stringify(id);
  const deps = collect_free_identifiers(candidate.expr_text);
  const deps_text = deps.length === 0 ? "[]" : `[${deps.join(", ")}]`;

  let replacement_text: string;
  let relocation: PendingRelocation | undefined;

  if (kind === "await") {
    replacement_text = emit_promise_expression(candidate, id_text, deps_text);
  } else if (kind === "render") {
    replacement_text = emit_render_expression(candidate, id_text, deps_text);
  } else if (kind === "each") {
    replacement_text = emit_each_expression(candidate, id_text, deps_text);
  } else if (kind === "event") {
    const event = strip_arrow_function(candidate.expr_text);
    replacement_text =
      `${event.params} => { void ${HELPERS.run}(function* () { ${event.body}; }); }`;
    relocation = make_relocation(candidate, replacement_text, {
      originalStart: event.body_start,
      originalEnd: event.body_end,
      generatedText: event.body,
    });
  } else {
    replacement_text = emit_each_expression(candidate, id_text, deps_text);
  }

  relocation ??= make_relocation(candidate, replacement_text, {
    originalStart: 0,
    originalEnd: candidate.expr_text.length,
    generatedText: candidate.expr_text,
  });

  return {
    start: candidate.start,
    end: candidate.end,
    text: replacement_text,
    relocation,
  };
}

function emit_promise_expression(
  candidate: MarkupCandidate,
  id_text: string,
  deps_text: string,
): string {
  return `${HELPERS.promise}(${id_text}, ${deps_text}, function* () { return (${candidate.expr_text}); })`;
}

function emit_render_expression(
  candidate: MarkupCandidate,
  id_text: string,
  deps_text: string,
): string {
  return `(await ${HELPERS.promise}(${id_text}, ${deps_text}, function* () { return (${candidate.expr_text}); }))()`;
}

function emit_each_expression(
  candidate: MarkupCandidate,
  id_text: string,
  deps_text: string,
): string {
  return `await ${HELPERS.promise}(${id_text}, ${deps_text}, function* () { return (${candidate.expr_text}); })`;
}

function make_relocation(
  candidate: MarkupCandidate,
  replacement_text: string,
  inner: {
    originalStart: number;
    originalEnd: number;
    generatedText: string;
  },
): PendingRelocation | undefined {
  const generated_start = replacement_text.indexOf(inner.generatedText);

  if (generated_start === -1) {
    return undefined;
  }

  return {
    originalStart: candidate.start + inner.originalStart,
    originalEnd: candidate.start + inner.originalEnd,
    generatedStartInReplacement: generated_start,
    generatedEndInReplacement: generated_start + inner.generatedText.length,
  };
}

function make_cache_id(candidate: MarkupCandidate): string {
  return `${candidate.filename}:${candidate.start}:${candidate.end}`;
}
