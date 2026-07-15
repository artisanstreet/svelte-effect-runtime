import type {
	HelperDeclaration,
	Insertion,
	MarkupHelperBindings,
	MarkupRelocation,
	PendingRelocation,
	Replacement,
} from "./types.ts";
import type { SvelteEffectSourceScan } from "$/compiler/source-scan.ts";
import { collect_top_level_binding_names } from "$/script-transform/imports.ts";
import { collect_markup_identifier_names } from "$/compiler/markup-identifiers.ts";
import { default_helper_bindings } from "./constants.ts";

import type MagicString from "magic-string";
import ts from "typescript";

export function create_source_map(magic: MagicString, filename: string): Record<string, unknown> {
	const map = magic.generateMap({
		hires: true,
		includeContent: true,
		source: filename,
	});

	return map as unknown as Record<string, unknown>;
}

export function inject_helpers(
	magic: MagicString,
	source_scan: SvelteEffectSourceScan,
	helpers: HelperDeclaration[] = [],
	bindings: MarkupHelperBindings = default_helper_bindings,
): Insertion | undefined {
	const import_helpers = unique_import_helpers(helpers);
	const local_helpers = helpers.filter((helper) => !is_import_helper(helper));

	const helper_segments: Array<{
		text: string;
		relocation?: PendingRelocation;
	}> = [make_dispatcher_import(bindings), ...import_helpers, ...local_helpers]
		.filter((helper): helper is string | HelperDeclaration => helper !== undefined)
		.map((helper) => (typeof helper === "string" ? { text: helper } : helper));

	if (helper_segments.length === 0) {
		return undefined;
	}

	const helper_block = helper_segments.map((segment) => segment.text).join("\n");

	const instance_script = source_scan.instance_script;

	if (instance_script) {
		const text = `\n${helper_block}\n`;

		magic.appendLeft(instance_script.content_end, text);

		return {
			start: instance_script.content_end,
			text,
			relocations: make_insertion_relocations(helper_segments, "\n"),
		};
	} else {
		const text = `<script>\n${helper_block}\n</script>\n\n`;

		magic.prepend(text);

		return {
			start: 0,
			text,
			relocations: make_insertion_relocations(helper_segments, "<script>\n"),
		};
	}
}

export function make_markup_helper_bindings(source_scan: SvelteEffectSourceScan): {
	bindings: MarkupHelperBindings;
	name_allocator: { reserve(name: string): string };
} {
	const script_binding_names = source_scan.scripts.flatMap((script) =>
		collect_script_binding_names(script.text),
	);
	const markup_identifier_names = collect_markup_identifier_names(source_scan);
	const name_allocator = make_name_allocator([
		...script_binding_names,
		...markup_identifier_names,
	]);

	return {
		bindings: {
			codes: name_allocator.reserve(default_helper_bindings.codes),
			dispatcher: name_allocator.reserve(default_helper_bindings.dispatcher),
			yieldable: name_allocator.reserve(default_helper_bindings.yieldable),
		},
		name_allocator,
	};
}

export function create_relocations(
	replacements: Replacement[],
	helper_insertion: Insertion | undefined,
): MarkupRelocation[] {
	const ordered_replacements = [...replacements].sort((left, right) => left.start - right.start);
	const replacement_deltas = new Map<Replacement, number>();
	let accumulated_delta = 0;
	let replacement_delta_before_helper = 0;
	let cursor = 0;

	while (cursor < ordered_replacements.length) {
		const start = ordered_replacements[cursor]?.start;
		let group_end = cursor;
		let group_delta = 0;

		while (ordered_replacements[group_end]?.start === start) {
			const replacement = ordered_replacements[group_end];

			if (replacement) {
				replacement_deltas.set(replacement, accumulated_delta);
				group_delta += replacement.text.length - (replacement.end - replacement.start);
			}

			group_end += 1;
		}

		if (helper_insertion && start !== undefined && start < helper_insertion.start) {
			replacement_delta_before_helper += group_delta;
		}

		accumulated_delta += group_delta;
		cursor = group_end;
	}

	const replacement_relocations = replacements.flatMap((replacement) => {
		if (!replacement.relocation) {
			return [];
		}

		const replacement_delta_before = replacement_deltas.get(replacement) ?? 0;
		const helper_insertion_delta =
			helper_insertion && helper_insertion.start <= replacement.start
				? helper_insertion.text.length
				: 0;
		const delta_before = replacement_delta_before + helper_insertion_delta;
		const generated_start = replacement.start + delta_before;

		return [
			{
				originalStart: replacement.relocation.originalStart,
				originalEnd: replacement.relocation.originalEnd,
				generatedStart:
					generated_start + replacement.relocation.generatedStartInReplacement,
				generatedEnd: generated_start + replacement.relocation.generatedEndInReplacement,
			},
		];
	});

	const helper_generated_start = (helper_insertion?.start ?? 0) + replacement_delta_before_helper;
	const helper_relocations =
		helper_insertion?.relocations?.map((relocation) => ({
			originalStart: relocation.originalStart,
			originalEnd: relocation.originalEnd,
			generatedStart: helper_generated_start + relocation.generatedStartInReplacement,
			generatedEnd: helper_generated_start + relocation.generatedEndInReplacement,
		})) ?? [];

	return [...replacement_relocations, ...helper_relocations];
}

function make_dispatcher_import(bindings: MarkupHelperBindings): string {
	const dispatcher = make_import_specifier(
		default_helper_bindings.dispatcher,
		bindings.dispatcher,
	);
	const codes = make_import_specifier(default_helper_bindings.codes, bindings.codes);
	const yieldable = make_import_specifier(default_helper_bindings.yieldable, bindings.yieldable);

	return `import { ${dispatcher}, ${codes}, ${yieldable} } from "svelte-effect-runtime/internal/generators";`;
}

function make_import_specifier(imported_name: string, local_name: string): string {
	if (imported_name === local_name) {
		return imported_name;
	}

	return `${imported_name} as ${local_name}`;
}

function make_insertion_relocations(
	segments: Array<{
		text: string;
		relocation?: PendingRelocation;
	}>,
	prefix: string,
): PendingRelocation[] {
	const relocations: PendingRelocation[] = [];
	let offset = prefix.length;

	for (const segment of segments) {
		if (segment.relocation) {
			relocations.push({
				originalStart: segment.relocation.originalStart,
				originalEnd: segment.relocation.originalEnd,
				generatedStartInReplacement:
					offset + segment.relocation.generatedStartInReplacement,
				generatedEndInReplacement: offset + segment.relocation.generatedEndInReplacement,
			});
		}

		offset += segment.text.length + 1;
	}

	return relocations;
}

function unique_import_helpers(helpers: HelperDeclaration[]): HelperDeclaration[] {
	const seen = new Set<string>();

	return helpers.filter((helper) => {
		if (!is_import_helper(helper)) {
			return false;
		}

		if (seen.has(helper.text)) {
			return false;
		}

		seen.add(helper.text);

		return true;
	});
}

function is_import_helper(helper: HelperDeclaration): boolean {
	return helper.text.trimStart().startsWith("import ");
}

function collect_script_binding_names(script_content: string): string[] {
	const source_file = ts.createSourceFile(
		"markup-script.ts",
		script_content,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);

	return collect_top_level_binding_names(source_file);
}

function make_name_allocator(initial_names: readonly string[]): {
	reserve(name: string): string;
} {
	const used_names = new Set(initial_names);

	return {
		reserve(name: string): string {
			let candidate = name;
			let suffix = 1;

			while (used_names.has(candidate)) {
				candidate = `${name}_${suffix}`;
				suffix += 1;
			}

			used_names.add(candidate);

			return candidate;
		},
	};
}
