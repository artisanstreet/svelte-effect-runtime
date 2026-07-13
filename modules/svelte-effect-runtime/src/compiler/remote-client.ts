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
	const source_file = ts.createSourceFile(
		"sveltekit-remote-client.ts",
		code,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const namespace_import = find_remote_namespace_import(source_file);

	if (!namespace_import) {
		return code;
	}

	const remote_exports = collect_remote_client_exports(source_file, code, namespace_import.name);

	if (remote_exports.length === 0) {
		return code;
	}

	const magic = new MagicString(code);
	const imports = [
		`import { app_dir, base } from "$app/paths/internal/client";`,
		`import { create_remote_query_adapter, create_remote_live_query_adapter, create_remote_command_adapter, create_remote_form_adapter } from "svelte-effect-runtime/internal/remote-client";`,
	].join("\n");
	const helpers = [
		`const __SER___remote_base = \`\${base}/\${app_dir}/remote\`;`,
		`function __SER___decode_payload(value) { return value; }`,
	].join("\n");
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

function make_remote_export(
	name: string,
	remote_type: RemoteClientExportType,
	native_call: string,
): string {
	if (remote_type === "command") {
		return `export const ${name} = create_remote_command_adapter(${native_call}, __SER___decode_payload);`;
	}

	if (remote_type === "form") {
		return `export const ${name} = create_remote_form_adapter(${native_call}, __SER___decode_payload, __SER___remote_base);`;
	}

	if (remote_type === "query_live") {
		return `export const ${name} = create_remote_live_query_adapter(${native_call}, __SER___decode_payload);`;
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
		statement.moduleSpecifier.text !== "__sveltekit/remote"
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
		statement,
	};
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
