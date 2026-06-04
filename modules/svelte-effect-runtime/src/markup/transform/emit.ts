import {
  NestedYieldStarInEventHandlerError,
  YieldStarInEventCallbackError,
} from "$/error.ts";
import { HELPERS } from "./constants.ts";
import {
  analyze_event_body_yield_star,
  collect_free_identifiers,
  is_callback_function_expression,
} from "./expressions.ts";
import type {
  HelperDeclaration,
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
  const helper_name = make_helper_name(candidate);

  let replacement_text: string;
  let helpers: HelperDeclaration[];
  let relocation: PendingRelocation | undefined;

  if (kind === "await") {
    const effect = make_effect_helper(candidate, helper_name);

    replacement_text = emit_promise_expression(id_text, effect);
    helpers = [effect.helper];
  } else if (kind === "render") {
    const effect = make_effect_helper(candidate, helper_name);

    replacement_text = emit_render_expression(id_text, effect);
    helpers = [effect.helper];
  } else if (kind === "each") {
    const effect = make_effect_helper(candidate, helper_name);

    replacement_text = emit_each_expression(id_text, effect);
    helpers = [effect.helper];
  } else if (kind === "event") {
    const event = make_event_handler(candidate);

    replacement_text = event.text;
    helpers = [];
    relocation = make_relocation(candidate, replacement_text, {
      originalStart: 0,
      originalEnd: candidate.expr_text.length,
      generatedText: candidate.expr_text,
    });
  } else {
    const effect = make_effect_helper(candidate, helper_name);

    replacement_text = emit_each_expression(id_text, effect);
    helpers = [effect.helper];
  }

  return {
    start: candidate.start,
    end: candidate.end,
    text: replacement_text,
    helpers,
    relocation,
  };
}

function make_event_handler(candidate: MarkupCandidate): { text: string } {
  if (is_callback_function_expression(candidate.expr_text)) {
    throw new YieldStarInEventCallbackError(
      candidate.filename,
      candidate.expr_text,
    );
  }

  const analysis = analyze_event_body_yield_star(candidate.expr_text);

  if (analysis.has_nested_invalid_yield_star) {
    throw new NestedYieldStarInEventHandlerError(
      candidate.filename,
      candidate.expr_text,
    );
  }

  return {
    text:
      `(event) => { void ${HELPERS.run}(function* () { ${candidate.expr_text}; }); }`,
  };
}

function emit_promise_expression(
  id_text: string,
  effect: EffectHelper,
): string {
  return `${HELPERS.promise}(${id_text}, ${effect.deps_text}, () => ${effect.call})`;
}

function emit_render_expression(
  id_text: string,
  effect: EffectHelper,
): string {
  return `(await ${emit_promise_expression(id_text, effect)})()`;
}

function emit_each_expression(
  id_text: string,
  effect: EffectHelper,
): string {
  return `await ${emit_promise_expression(id_text, effect)}`;
}

interface EffectHelper {
  helper: HelperDeclaration;
  call: string;
  deps_text: string;
}

function make_effect_helper(
  candidate: MarkupCandidate,
  helper_name: string,
): EffectHelper {
  const deps = collect_free_identifiers(candidate.expr_text);
  const params_text = deps.join(", ");
  const args_text = deps.join(", ");
  const deps_text = deps.length === 0 ? "[]" : `[${args_text}]`;
  const call = `${helper_name}(${args_text})`;
  const text =
    `function* ${helper_name}(${params_text}) { return (${candidate.expr_text}); }`;
  const generated_start = text.indexOf(candidate.expr_text);

  return {
    call,
    deps_text,
    helper: {
      text,
      relocation: {
        originalStart: candidate.start,
        originalEnd: candidate.end,
        generatedStartInReplacement: generated_start,
        generatedEndInReplacement: generated_start +
          candidate.expr_text.length,
      },
    },
  };
}

function make_cache_id(candidate: MarkupCandidate): string {
  return `${candidate.filename}:${candidate.start}:${candidate.end}`;
}

function make_helper_name(candidate: MarkupCandidate): string {
  return `__ser_markup_effect_${candidate.start}_${candidate.end}`;
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
