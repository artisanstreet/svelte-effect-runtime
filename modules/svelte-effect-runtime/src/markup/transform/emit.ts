import {
  AsyncEffectInEventCallbackError,
  YieldStarInEventCallbackError,
} from "$/errors.ts";
import type { EffectCallbackRewriteContext } from "./effect-bindings.ts";
import {
  analyze_event_body_yield_star,
  collect_free_identifiers,
  is_callback_function_expression,
} from "./expressions.ts";
import { normalize_effect_callback_yields } from "./effect-callbacks.ts";
import type {
  HelperDeclaration,
  MarkupCandidate,
  MarkupHelperBindings,
  MarkupNameAllocator,
  MarkupTransformTarget,
  PendingRelocation,
  Replacement,
  TagKind,
} from "./types.ts";

/**
 * Emits source edits for classified markup Effect expressions.
 *
 * @since 2.0.0
 * @param classified - Candidates paired with their Svelte markup context.
 * @param effect_context - Effect import bindings available to markup
 *   expression rewrites.
 * @returns Replacements ready to apply to the original component source.
 */
export function emit_replacements(
  classified: Array<{ candidate: MarkupCandidate; kind: TagKind }>,
  effect_context: EffectCallbackRewriteContext,
  helper_bindings: MarkupHelperBindings,
  name_allocator: MarkupNameAllocator,
  target: MarkupTransformTarget,
): Replacement[] {
  return classified.map(({ candidate, kind }) =>
    emit_replacement(
      candidate,
      kind,
      effect_context,
      helper_bindings,
      name_allocator,
      target,
    )
  );
}

function emit_replacement(
  candidate: MarkupCandidate,
  kind: TagKind,
  effect_context: EffectCallbackRewriteContext,
  helper_bindings: MarkupHelperBindings,
  name_allocator: MarkupNameAllocator,
  target: MarkupTransformTarget,
): Replacement {
  const normalized = normalize_effect_callback_yields(
    candidate.expr_text,
    effect_context,
  );
  const normalized_candidate = {
    ...candidate,
    expr_text: normalized.expr_text,
  };
  const id = make_cache_id(candidate);
  const id_text = JSON.stringify(id);
  const helper_name = make_helper_name(candidate, name_allocator);
  const use_value_read = target !== "server";

  let replacement_text: string;
  let helpers: HelperDeclaration[];
  let relocation: PendingRelocation | undefined;

  if (kind === "await") {
    const effect = make_effect_helper(normalized_candidate, helper_name);

    replacement_text = emit_promise_expression(
      id_text,
      effect,
      helper_bindings,
      "undefined",
      `{ ssr: "pending" }`,
    );
    helpers = [...normalized.helpers, effect.helper];
  } else if (kind === "render") {
    const effect = make_effect_helper(normalized_candidate, helper_name);

    replacement_text = use_value_read
      ? emit_render_value_expression(id_text, effect, helper_bindings)
      : emit_render_expression(
        id_text,
        effect,
        candidate,
        helper_bindings,
      );
    helpers = [...normalized.helpers, effect.helper];
  } else if (kind === "render_argument") {
    const effect = make_effect_helper(normalized_candidate, helper_name);

    replacement_text = use_value_read
      ? emit_value_expression(id_text, effect, helper_bindings)
      : emit_await_expression(id_text, effect, helper_bindings);
    helpers = [...normalized.helpers, effect.helper];
  } else if (kind === "each") {
    const effect = make_effect_helper(normalized_candidate, helper_name);

    replacement_text = use_value_read
      ? emit_value_expression(id_text, effect, helper_bindings, "[]")
      : emit_await_expression(id_text, effect, helper_bindings);
    helpers = [...normalized.helpers, effect.helper];
  } else if (kind === "event") {
    const event = make_event_handler(normalized_candidate, helper_bindings);

    replacement_text = event.text;
    helpers = normalized.helpers;
    relocation = make_relocation(candidate, replacement_text, {
      originalStart: 0,
      originalEnd: candidate.expr_text.length,
      generatedText: event.expr_text,
    });
  } else {
    const effect = make_effect_helper(normalized_candidate, helper_name);

    replacement_text = use_value_read
      ? emit_value_expression(id_text, effect, helper_bindings)
      : emit_await_expression(id_text, effect, helper_bindings);
    helpers = [...normalized.helpers, effect.helper];
  }

  return {
    start: candidate.start,
    end: candidate.end,
    text: replacement_text,
    helpers,
    relocation,
  };
}

function make_event_handler(
  candidate: MarkupCandidate,
  helper_bindings: MarkupHelperBindings,
): { text: string; expr_text: string } {
  const expr_text = candidate.expr_text;

  if (is_callback_function_expression(expr_text)) {
    throw new YieldStarInEventCallbackError(
      candidate.filename,
      expr_text,
    );
  }

  const analysis = analyze_event_body_yield_star(expr_text);

  if (analysis.has_nested_invalid_yield_star) {
    throw new AsyncEffectInEventCallbackError(
      candidate.filename,
      expr_text,
    );
  }

  return {
    expr_text,
    text:
      `(event) => { ${helper_bindings.run}(function* () { ${expr_text}; }); }`,
  };
}

function emit_promise_expression(
  id_text: string,
  effect: EffectHelper,
  helper_bindings: MarkupHelperBindings,
  ssr_fallback?: string,
  options?: string,
): string {
  const args = [
    id_text,
    effect.deps_text,
    `() => ${effect.call}`,
    ssr_fallback,
    options,
  ].filter((arg): arg is string => arg !== undefined);

  return `${helper_bindings.promise}(${args.join(", ")})`;
}

function emit_value_expression(
  id_text: string,
  effect: EffectHelper,
  helper_bindings: MarkupHelperBindings,
  fallback = "undefined",
): string {
  const args = [
    id_text,
    effect.deps_text,
    fallback,
    `() => ${effect.call}`,
  ];

  return `${helper_bindings.value}(${args.join(", ")})`;
}

function emit_render_expression(
  id_text: string,
  effect: EffectHelper,
  candidate: MarkupCandidate,
  helper_bindings: MarkupHelperBindings,
): string {
  const expression = emit_promise_expression(id_text, effect, helper_bindings);

  if (/^\s*yield\s*\*/.test(candidate.expr_text)) {
    return `(await ${expression})()`;
  }

  return `await ${expression}`;
}

function emit_render_value_expression(
  id_text: string,
  effect: EffectHelper,
  helper_bindings: MarkupHelperBindings,
): string {
  return `${emit_value_expression(id_text, effect, helper_bindings)}?.()`;
}

function emit_await_expression(
  id_text: string,
  effect: EffectHelper,
  helper_bindings: MarkupHelperBindings,
  ssr_fallback?: string,
): string {
  return `await ${
    emit_promise_expression(
      id_text,
      effect,
      helper_bindings,
      ssr_fallback,
    )
  }`;
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
  const args_text = deps.join(", ");
  const deps_text = deps.length === 0 ? "[]" : `[${args_text}]`;
  const call = `${helper_name}()`;
  const text =
    `function* ${helper_name}() { return (${candidate.expr_text}); }`;
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
  const normalized_filename = candidate.filename.replace(/[?#].*$/, "");

  return `${normalized_filename}:${candidate.start}:${candidate.end}`;
}

function make_helper_name(
  candidate: MarkupCandidate,
  name_allocator: MarkupNameAllocator,
): string {
  return name_allocator.reserve(
    `__SER___markup_effect_${candidate.start}_${candidate.end}`,
  );
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
