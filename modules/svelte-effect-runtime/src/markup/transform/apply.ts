import type {
	HelperDeclaration,
	Insertion,
	MarkupTransformTarget,
	MarkupHelperBindings,
	MarkupRelocation,
	MarkupScopeWiring,
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
	scope_wiring?: MarkupScopeWiring | undefined,
): Insertion | undefined {
	const import_helpers = unique_import_helpers(helpers);
	const local_helpers = helpers.filter((helper) => !is_import_helper(helper));

	const helper_segments: Array<{
		text: string;
		relocation?: PendingRelocation;
	}> = [make_dispatcher_import(bindings, scope_wiring), ...import_helpers, ...local_helpers]
		.filter((helper): helper is string | HelperDeclaration => helper !== undefined)
		.map((helper) => (typeof helper === "string" ? { text: helper } : helper));

	if (helper_segments.length === 0) {
		return undefined;
	}

	const helper_block = helper_segments.map((segment) => segment.text).join("\n");
	const scope_block = scope_wiring ? make_scope_wiring_block(bindings, scope_wiring) : undefined;

	const instance_script = source_scan.instance_script;

	if (instance_script) {
		/**
		 * The scope holder must be declared before any user statement so its
		 * `onDestroy` runs during component initialisation, ahead of any
		 * top-level `await`.
		 */
		const scope_text = scope_block ? `\n${scope_block}\n` : undefined;

		if (scope_text) {
			magic.appendLeft(instance_script.content_start, scope_text);
		}

		const text = `\n${helper_block}\n`;

		magic.appendLeft(instance_script.content_end, text);

		return {
			start: instance_script.content_end,
			text,
			extra_insertions: scope_text
				? [{ start: instance_script.content_start, text: scope_text }]
				: [],
			relocations: make_insertion_relocations(helper_segments, "\n"),
		};
	} else {
		const text = `<script>\n${[scope_block, helper_block].filter(Boolean).join("\n")}\n</script>\n\n`;
		const helper_prefix = `<script>\n${scope_block ? scope_block + "\n" : ""}`;

		magic.prepend(text);

		return {
			start: 0,
			text,
			relocations: make_insertion_relocations(helper_segments, helper_prefix),
		};
	}
}

export function make_markup_helper_bindings(
	source_scan: SvelteEffectSourceScan,
	target: MarkupTransformTarget = "client",
): {
	bindings: MarkupHelperBindings;
	name_allocator: { reserve(name: string): string };
	scope_wiring: MarkupScopeWiring | undefined;
} {
	const script_binding_names = source_scan.scripts.flatMap((script) =>
		collect_script_binding_names(script.text),
	);
	const markup_identifier_names = collect_markup_identifier_names(source_scan);
	const detected_scope_name = extract_script_scope_binding(source_scan.scripts);
	const name_allocator = make_name_allocator([
		...script_binding_names,
		...markup_identifier_names,
	]);

	const scope = detected_scope_name ?? name_allocator.reserve(default_helper_bindings.scope);

	const bindings = {
		codes: name_allocator.reserve(default_helper_bindings.codes),
		dispatcher: name_allocator.reserve(default_helper_bindings.dispatcher),
		yieldable: name_allocator.reserve(default_helper_bindings.yieldable),
		scope,
	};

	const is_server_target = target === "server";

	/**
	 * The script transform declares the component scope holder when it lowers
	 * a `<script effect>`. When no script declares one — a markup-only
	 * component for client/editor targets — reserve the names the injected scope
	 * wiring needs so markup emit calls still have a scope to enter.
	 */
	const scope_present = detected_scope_name !== undefined;
	const scope_wiring = scope_present
		? undefined
		: {
				component_scope_ref: name_allocator.reserve("ComponentScopeRef"),
				get_dispatcher: name_allocator.reserve("get_dispatcher"),
				...(is_server_target ? {} : { on_destroy: name_allocator.reserve("onDestroy") }),
			};

	return {
		bindings,
		name_allocator,
		scope_wiring,
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

	const insertion_shift_before = (point: number): number => {
		if (!helper_insertion) {
			return 0;
		}

		const helper_shift = helper_insertion.start <= point ? helper_insertion.text.length : 0;
		const extra_shift = (helper_insertion.extra_insertions ?? [])
			.filter((insertion) => insertion.start <= point)
			.reduce((shift, insertion) => shift + insertion.text.length, 0);

		return helper_shift + extra_shift;
	};

	const replacement_relocations = replacements.flatMap((replacement) => {
		if (!replacement.relocation) {
			return [];
		}

		const replacement_delta_before = replacement_deltas.get(replacement) ?? 0;
		const delta_before = replacement_delta_before + insertion_shift_before(replacement.start);
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

	const helper_generated_start =
		(helper_insertion?.start ?? 0) +
		replacement_delta_before_helper +
		(helper_insertion?.extra_insertions ?? [])
			.filter((insertion) => helper_insertion && insertion.start <= helper_insertion.start)
			.reduce((shift, insertion) => shift + insertion.text.length, 0);
	const helper_relocations =
		helper_insertion?.relocations?.map((relocation) => ({
			originalStart: relocation.originalStart,
			originalEnd: relocation.originalEnd,
			generatedStart: helper_generated_start + relocation.generatedStartInReplacement,
			generatedEnd: helper_generated_start + relocation.generatedEndInReplacement,
		})) ?? [];

	return [...replacement_relocations, ...helper_relocations];
}

function make_dispatcher_import(
	bindings: MarkupHelperBindings,
	scope_wiring?: MarkupScopeWiring | undefined,
): string {
	const dispatcher = make_import_specifier(
		default_helper_bindings.dispatcher,
		bindings.dispatcher,
	);
	const codes = make_import_specifier(default_helper_bindings.codes, bindings.codes);
	const yieldable = make_import_specifier(default_helper_bindings.yieldable, bindings.yieldable);

	/**
	 * The scope holder's imports ride on the shared generators import so the
	 * component keeps a single import from the runtime entrypoint.
	 */
	const scope_specifiers = scope_wiring
		? [
				make_import_specifier("ComponentScopeRef", scope_wiring.component_scope_ref),
				make_import_specifier("get_dispatcher", scope_wiring.get_dispatcher),
			]
		: [];

	return `import { ${[dispatcher, codes, yieldable, ...scope_specifiers].join(", ")} } from "svelte-effect-runtime/internal/generators";`;
}

function make_import_specifier(imported_name: string, local_name: string): string {
	if (imported_name === local_name) {
		return imported_name;
	}

	return `${imported_name} as ${local_name}`;
}

function make_scope_wiring_block(
	bindings: MarkupHelperBindings,
	scope_wiring: MarkupScopeWiring,
): string {
	const on_destroy_import = scope_wiring.on_destroy
		? make_import_specifier("onDestroy", scope_wiring.on_destroy)
		: undefined;
	const on_destroy_call = scope_wiring.on_destroy
		? `${scope_wiring.on_destroy}(() => ${bindings.scope}.dispose());`
		: undefined;
	const import_statement = on_destroy_import
		? `import { ${on_destroy_import} } from "svelte";`
		: undefined;

	return [
		import_statement,
		`const ${bindings.scope} = new ${scope_wiring.component_scope_ref}(${scope_wiring.get_dispatcher});`,
		on_destroy_call,
	].join("\n");
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

function extract_script_scope_binding(
	scripts: ReadonlyArray<{ readonly text: string }>,
): string | undefined {
	for (const { text } of scripts) {
		const source_file = ts.createSourceFile(
			"markup-script.ts",
			text,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);

		const component_scope_refs = collect_component_scope_ref_names(source_file);

		for (const stmt of source_file.statements) {
			if (!ts.isVariableStatement(stmt)) {
				continue;
			}

			for (const decl of stmt.declarationList.declarations) {
				if (!ts.isIdentifier(decl.name)) {
					continue;
				}

				if (!is_generated_scope_name(decl.name.text)) {
					continue;
				}

				if (!decl.initializer || !ts.isNewExpression(decl.initializer)) {
					continue;
				}

				if (
					ts.isIdentifier(decl.initializer.expression) &&
					component_scope_refs.has(decl.initializer.expression.text)
				) {
					return decl.name.text;
				}

				if (
					ts.isPropertyAccessExpression(decl.initializer.expression) &&
					ts.isIdentifier(decl.initializer.expression.expression) &&
					component_scope_refs.has(decl.initializer.expression.expression.text) &&
					decl.initializer.expression.name.text === "ComponentScopeRef"
				) {
					return decl.name.text;
				}
			}
		}
	}

	return undefined;
}

function collect_component_scope_ref_names(source_file: ts.SourceFile): Set<string> {
	const scope_ref_names = new Set(["ComponentScopeRef"]);

	for (const stmt of source_file.statements) {
		if (
			!ts.isImportDeclaration(stmt) ||
			!ts.isStringLiteral(stmt.moduleSpecifier) ||
			stmt.moduleSpecifier.text !== "svelte-effect-runtime/internal/generators"
		) {
			continue;
		}

		const clause = stmt.importClause;

		if (!clause || clause.isTypeOnly) {
			continue;
		}

		const named_bindings = clause.namedBindings;

		if (!named_bindings || !ts.isNamedImports(named_bindings)) {
			continue;
		}

		for (const element of named_bindings.elements) {
			if (element.propertyName?.text === "ComponentScopeRef") {
				scope_ref_names.add(element.name.text);
			}
		}
	}

	return scope_ref_names;
}

function is_generated_scope_name(name: string): boolean {
	return /^__SER___scope(?:_\d+)?$/.test(name);
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
