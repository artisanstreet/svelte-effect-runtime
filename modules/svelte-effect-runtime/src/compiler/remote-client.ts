import type {
	Expression,
	ImportDeclaration,
	SourceFile,
	Statement,
	VariableStatement,
} from "typescript";

import MagicString from "magic-string";
import ts from "typescript";

interface RemoteClientRewriteOptions {
	debug?: boolean;
}

type RemoteClientExportType =
	| "query_batch"
	| "query_live"
	| "query"
	| "command"
	| "form"
	| "prerender";

interface RemoteNamespaceImport {
	name: string;
	specifier: string;
	statement: ImportDeclaration;
}

interface RemoteClientExport {
	name: string;
	type: RemoteClientExportType;
	statement: VariableStatement;
	native_call: string;
}

const remote_client_export_types = new Set<RemoteClientExportType>([
	"query_batch",
	"query_live",
	"query",
	"command",
	"form",
	"prerender",
]);

/** Rewrites SvelteKit's generated remote client exports to SER adapters. */
export function rewrite_remote_client_exports(
	code: string,
	options?: RemoteClientRewriteOptions,
): string {
	const source_file = create_remote_client_source_file(code);
	const namespace_import = find_remote_namespace_import(source_file);

	if (!namespace_import) {
		return code;
	}

	const remote_exports = collect_remote_client_exports(source_file, code, namespace_import.name);

	if (remote_exports.length === 0) {
		return code;
	}

	const magic = new MagicString(code);
	const has_remote_form = remote_exports.some((remote_export) => remote_export.type === "form");
	const imports = [
		`import { create_remote_query_adapter, create_remote_live_query_adapter, create_remote_prerender_adapter, create_remote_command_adapter, create_remote_form_adapter } from "svelte-effect-runtime/internal/remote-client";`,
		has_remote_form &&
			`import { goto as __SER___goto, invalidateAll as __SER___invalidate_all } from "$app/navigation";`,
		`import { app_dir, base } from "$app/paths/internal/client";`,
	]
		.filter(Boolean)
		.join("\n");

	const helpers = [
		`const __SER___remote_base = \`\${base}/\${app_dir}/remote\`;`,
		`function __SER___decode_payload(value) { return value; }`,
		has_remote_form &&
			[
				`function __SER___navigate_remote_form(location, invalidate_all) {`,
				`\tconst target = new URL(location, globalThis.location.href);`,
				``,
				`\tif (target.origin !== globalThis.location.origin) {`,
				`\t\tglobalThis.location.assign(target.href);`,
				``,
				`\t\treturn Promise.resolve();`,
				`\t}`,
				``,
				`\treturn __SER___goto(target, { invalidateAll: invalidate_all });`,
				`}`,
			].join("\n"),
		has_remote_form &&
			`const __SER___remote_form_transport = { binary_form_content_type: ${namespace_import.name}.__SER___binary_form_content_type, navigate: __SER___navigate_remote_form, refresh: __SER___invalidate_all, remote_request: ${namespace_import.name}.__SER___remote_request, serialize_binary_form: ${namespace_import.name}.__SER___serialize_binary_form };`,
	]
		.filter(Boolean)
		.join("\n");
	const debug_line = options?.debug ? `console.log("[ser] remote client wrappers loaded");` : "";
	const injected = [imports, helpers, debug_line].filter(Boolean).join("\n");

	magic.appendRight(namespace_import.statement.end, `\n${injected}`);

	for (const remote_export of remote_exports) {
		magic.overwrite(
			remote_export.statement.getStart(source_file),
			remote_export.statement.end,
			make_remote_export(remote_export.name, remote_export.type, remote_export.native_call),
		);
	}

	return magic.toString();
}

export function find_remote_client_runtime_specifier(code: string): string | undefined {
	const source_file = create_remote_client_source_file(code);

	return find_remote_namespace_import(source_file)?.specifier;
}

function create_remote_client_source_file(code: string): SourceFile {
	return ts.createSourceFile(
		"sveltekit-remote-client.ts",
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
}

function make_remote_export(
	name: string,
	remote_type: RemoteClientExportType,
	native_call: string,
): string {
	if (remote_type === "command") {
		return `export const ${name} = create_remote_command_adapter(${native_call}, __SER___decode_payload);`;
	}

	if (remote_type === "form") {
		return `export const ${name} = create_remote_form_adapter(${native_call}, __SER___decode_payload, __SER___remote_base, __SER___remote_form_transport);`;
	}

	if (remote_type === "query_live") {
		return `export const ${name} = create_remote_live_query_adapter(${native_call}, __SER___decode_payload);`;
	}

	if (remote_type === "prerender") {
		return `export const ${name} = create_remote_prerender_adapter(${native_call}, __SER___decode_payload);`;
	}

	if (remote_type === "query_batch") {
		return `export const ${name} = create_remote_query_adapter(${native_call}, __SER___decode_payload, "", "batch");`;
	}

	return `export const ${name} = create_remote_query_adapter(${native_call}, __SER___decode_payload);`;
}

function find_remote_namespace_import(source_file: SourceFile): RemoteNamespaceImport | undefined {
	for (const statement of source_file.statements) {
		if (!ts.isImportDeclaration(statement)) {
			continue;
		}

		const namespace_import = get_remote_namespace_import(statement);

		if (namespace_import) {
			return namespace_import;
		}
	}

	return undefined;
}

function get_remote_namespace_import(
	statement: ImportDeclaration,
): RemoteNamespaceImport | undefined {
	if (
		!ts.isStringLiteral(statement.moduleSpecifier) ||
		!is_sveltekit_remote_client_specifier(statement.moduleSpecifier.text)
	) {
		return undefined;
	}

	const import_clause = statement.importClause;
	const bindings = import_clause?.namedBindings;

	if (import_clause?.isTypeOnly || !bindings || !ts.isNamespaceImport(bindings)) {
		return undefined;
	}

	return {
		name: bindings.name.text,
		specifier: statement.moduleSpecifier.text,
		statement,
	};
}

function is_sveltekit_remote_client_specifier(specifier: string): boolean {
	const normalized_specifier = specifier.replaceAll("\\", "/");

	return (
		normalized_specifier === "__sveltekit/remote" ||
		normalized_specifier.endsWith("/@sveltejs/kit/src/runtime/client/remote-functions/index.js")
	);
}

function collect_remote_client_exports(
	source_file: SourceFile,
	code: string,
	namespace: string,
): RemoteClientExport[] {
	return source_file.statements.flatMap((statement) =>
		collect_remote_client_export(source_file, code, namespace, statement),
	);
}

function collect_remote_client_export(
	source_file: SourceFile,
	code: string,
	namespace: string,
	statement: Statement,
): RemoteClientExport[] {
	if (
		!ts.isVariableStatement(statement) ||
		!is_export_statement(statement) ||
		!is_const_declaration_list(statement.declarationList) ||
		statement.declarationList.declarations.length !== 1
	) {
		return [];
	}

	const declaration = statement.declarationList.declarations[0];
	const initializer = declaration.initializer;

	if (!ts.isIdentifier(declaration.name) || !initializer) {
		return [];
	}

	const remote_type = get_remote_client_export_type(initializer, namespace);

	if (!remote_type) {
		return [];
	}

	return [
		{
			name: declaration.name.text,
			type: remote_type,
			statement,
			native_call: code.slice(initializer.getStart(source_file), initializer.end),
		},
	];
}

function get_remote_client_export_type(
	initializer: Expression,
	namespace: string,
): RemoteClientExportType | undefined {
	if (!ts.isCallExpression(initializer)) {
		return undefined;
	}

	const expression = initializer.expression;

	if (!ts.isPropertyAccessExpression(expression)) {
		return undefined;
	}

	if (!ts.isIdentifier(expression.expression) || expression.expression.text !== namespace) {
		return undefined;
	}

	const remote_type = expression.name.text;

	if (!is_remote_client_export_type(remote_type)) {
		return undefined;
	}

	return remote_type;
}

function is_remote_client_export_type(value: string): value is RemoteClientExportType {
	return remote_client_export_types.has(value as RemoteClientExportType);
}

function is_export_statement(statement: Statement): boolean {
	const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;

	return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function is_const_declaration_list(declaration_list: ts.VariableDeclarationList): boolean {
	return (ts.getCombinedNodeFlags(declaration_list) & ts.NodeFlags.Const) !== 0;
}
