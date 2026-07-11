import type MagicString from "magic-string";

import { collect_top_level_binding_names } from "$/script-transform/imports.ts";
import { HELPERS } from "./constants.ts";
import type {
	HelperDeclaration,
	Insertion,
	MarkupHelperBindings,
	MarkupRelocation,
	PendingRelocation,
	Replacement,
} from "./types.ts";
import ts from "typescript";

export function create_source_map(magic: MagicString, filename: string): Record<string, unknown> {
	const map = magic.generateMap({
		hires: true,
		includeContent: true,
		source: filename,
	});

	return map as unknown as Record<string, unknown>;
}

export function blank_script_blocks(content: string): string {
	return content.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (match) => {
		const lines = match.split("\n");
		return lines.map((l) => " ".repeat(l.length)).join("\n");
	});
}

export function inject_helpers(
	magic: MagicString,
	content: string,
	helpers: HelperDeclaration[] = [],
	bindings: MarkupHelperBindings = HELPERS,
): Insertion | undefined {
	const import_helpers = unique_import_helpers(helpers);
	const local_helpers = helpers.filter((helper) => !is_import_helper(helper));

	const helper_segments: Array<{
		text: string;
		relocation?: PendingRelocation;
	}> = [
		make_import_helper(content, make_dispatcher_import(bindings)),
		...import_helpers,
		...local_helpers,
	]
		.filter((helper): helper is string | HelperDeclaration => helper !== undefined)
		.map((helper) => (typeof helper === "string" ? { text: helper } : helper));

	if (helper_segments.length === 0) {
		return undefined;
	}

	const helper_block = helper_segments.map((segment) => segment.text).join("\n");

	const script_tag = find_instance_script_tag(content);

	if (script_tag) {
		const text = `\n${helper_block}\n`;

		magic.appendLeft(script_tag.end, text);

		return {
			start: script_tag.end,
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

export function make_markup_helper_bindings(content: string): {
	bindings: MarkupHelperBindings;
	name_allocator: { reserve(name: string): string };
} {
	const script_tag = find_instance_script_tag(content);
	const binding_names = script_tag
		? collect_script_binding_names(content.slice(script_tag.start, script_tag.end))
		: [];
	const name_allocator = make_name_allocator(binding_names);

	return {
		bindings: {
			codes: name_allocator.reserve(HELPERS.codes),
			dispatcher: name_allocator.reserve(HELPERS.dispatcher),
			yieldable: name_allocator.reserve(HELPERS.yieldable),
		},
		name_allocator,
	};
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

	const replacement_relocations = replacements.flatMap((replacement) => {
		if (!replacement.relocation) {
			return [];
		}

		const delta_before = edits
			.filter((edit) => edit.start < replacement.start)
			.reduce((total, edit) => total + edit.insertedLength - edit.removedLength, 0);
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

	const helper_relocations =
		helper_insertion?.relocations?.map((relocation) => ({
			originalStart: relocation.originalStart,
			originalEnd: relocation.originalEnd,
			generatedStart: helper_insertion.start + relocation.generatedStartInReplacement,
			generatedEnd: helper_insertion.start + relocation.generatedEndInReplacement,
		})) ?? [];

	return [...replacement_relocations, ...helper_relocations];
}

function make_import_helper(content: string, import_text: string): string | undefined {
	if (content.includes(import_text)) {
		return undefined;
	}

	return import_text;
}

function make_dispatcher_import(bindings: MarkupHelperBindings): string {
	const dispatcher = make_import_specifier(HELPERS.dispatcher, bindings.dispatcher);
	const codes = make_import_specifier(HELPERS.codes, bindings.codes);
	const yieldable = make_import_specifier(HELPERS.yieldable, bindings.yieldable);

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

function find_instance_script_tag(content: string): { start: number; end: number } | undefined {
	const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

	for (const match of content.matchAll(pattern)) {
		if (match.index === undefined) continue;

		const attrs = match[1] ?? "";
		if (/\bcontext\s*=\s*["']module["']/.test(attrs) || /\bmodule\b/.test(attrs)) {
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
