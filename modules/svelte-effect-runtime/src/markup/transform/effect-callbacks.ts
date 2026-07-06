import { contains_top_level_yield_star } from "$/detect.ts";
import type { EffectCallbackRewriteContext } from "./effect-bindings.ts";
import type { HelperDeclaration } from "./types.ts";

import MagicString from "magic-string";
import ts from "typescript";

const match_effect_members = new Map([
	["match", "matchEffect"],
	["matchCause", "matchCauseEffect"],
]);

const effectful_callback_members = new Set([
	"andThen",
	"catchAll",
	"catchAllCause",
	"catchCause",
	"catchTag",
	"flatMap",
	"forEach",
	"tap",
	"tapError",
	"tapErrorCause",
]);

const effectful_handler_members = new Set(["matchCauseEffect", "matchEffect", "tapBoth"]);

const effectful_handler_property_names = new Set(["onFailure", "onSuccess"]);

interface RewriteContext {
	source_file: ts.SourceFile;
	source_text: string;
	magic: MagicString;
	offset: number;
	bindings: EffectCallbackRewriteContext;
	changed: boolean;
	uses_wrapper: boolean;
}

interface EffectMember {
	name: string;
	name_start: number;
	name_end: number;
	direct: boolean;
}

type EffectWrapperMember = "gen" | "sync";

/**
 * Rewrites effectful callback shorthand inside event handler expressions.
 *
 * @example
 * ```ts
 * normalize_effect_callback_yields(
 *   `yield* action.pipe(Effect.flatMap((value) => yield* next(value)))`,
 *   collect_effect_callback_bindings(source),
 * );
 * ```
 *
 * @since 2.0.0
 * @param expr_text - Markup expression text before it is wrapped in the
 *   generated Effect runner.
 * @param bindings - Local Effect import bindings collected from the Svelte
 *   component's script blocks.
 * @returns The expression with nested Effect callback `yield*` shorthand
 *   lowered into explicit Effect callbacks, plus any import needed by generated
 *   wrapper calls.
 */
export function normalize_effect_callback_yields(
	expr_text: string,
	bindings: EffectCallbackRewriteContext,
): { expr_text: string; helpers: HelperDeclaration[] } {
	const prefix = "const __SER___expression = ";
	const source_text = `${prefix}${expr_text};`;
	const source_file = ts.createSourceFile(
		"event-expression.ts",
		source_text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const statement = source_file.statements[0];
	const magic = new MagicString(expr_text);
	const context: RewriteContext = {
		source_file,
		source_text,
		magic,
		offset: prefix.length,
		bindings,
		changed: false,
		uses_wrapper: false,
	};

	if (!ts.isVariableStatement(statement)) {
		return { expr_text, helpers: [] };
	}

	const expression = statement.declarationList.declarations[0]?.initializer;

	if (!expression) {
		return { expr_text, helpers: [] };
	}

	visit_expression(expression, context);

	if (!context.changed) {
		return { expr_text, helpers: [] };
	}

	const helpers =
		context.uses_wrapper && bindings.wrapper_import ? [bindings.wrapper_import] : [];

	return {
		expr_text: magic.toString(),
		helpers,
	};
}

function visit_expression(node: ts.Node, context: RewriteContext): void {
	if (is_non_generator_callback_with_top_level_yield(node)) {
		return;
	}

	if (ts.isCallExpression(node)) {
		rewrite_match_call(node, context);
		rewrite_effectful_handler_call(node, context);
		rewrite_effectful_callback_arguments(node, context);
	}

	node.forEachChild((child) => {
		visit_expression(child, context);
	});
}

function rewrite_match_call(call: ts.CallExpression, context: RewriteContext): void {
	const member = get_effect_member(call.expression, context);
	const upgraded_name = member && match_effect_members.get(member.name);
	const options = get_last_object_argument(call);

	if (!member || !upgraded_name || !options) {
		return;
	}

	const handlers = get_handler_properties(options);
	const should_upgrade = handlers.some(
		(handler) =>
			handler.callback && is_non_generator_callback_with_top_level_yield(handler.callback),
	);

	if (!should_upgrade) {
		return;
	}

	rewrite_effect_member_name(member, upgraded_name, context);
	context.changed = true;

	for (const handler of handlers) {
		if (!handler.callback) {
			continue;
		}

		if (is_non_generator_callback_with_top_level_yield(handler.callback)) {
			rewrite_callback_to_effect_gen(handler.callback, context);
		} else {
			rewrite_callback_to_effect_sync(handler.callback, context);
		}
	}
}

function rewrite_effectful_handler_call(call: ts.CallExpression, context: RewriteContext): void {
	const member = get_effect_member(call.expression, context);
	const options = get_last_object_argument(call);

	if (!member || !effectful_handler_members.has(member.name) || !options) {
		return;
	}

	for (const handler of get_handler_properties(options)) {
		if (handler.callback && is_non_generator_callback_with_top_level_yield(handler.callback)) {
			rewrite_callback_to_effect_gen(handler.callback, context);
		}
	}
}

function rewrite_effectful_callback_arguments(
	call: ts.CallExpression,
	context: RewriteContext,
): void {
	const member = get_effect_member(call.expression, context);

	if (!member || !effectful_callback_members.has(member.name)) {
		return;
	}

	for (const argument of call.arguments) {
		if (
			is_callback_expression(argument) &&
			is_non_generator_callback_with_top_level_yield(argument)
		) {
			rewrite_callback_to_effect_gen(argument, context);
		}
	}
}

function rewrite_callback_to_effect_gen(
	callback: ts.ArrowFunction | ts.FunctionExpression,
	context: RewriteContext,
): void {
	if (is_async_function(callback)) {
		return;
	}

	if (ts.isArrowFunction(callback)) {
		rewrite_arrow_callback(callback, "gen", context);
		return;
	}

	rewrite_function_body(callback, "gen", context);
}

function rewrite_callback_to_effect_sync(
	callback: ts.ArrowFunction | ts.FunctionExpression,
	context: RewriteContext,
): void {
	if (is_async_function(callback)) {
		return;
	}

	if (ts.isArrowFunction(callback)) {
		rewrite_arrow_callback(callback, "sync", context);
		return;
	}

	rewrite_function_body(callback, "sync", context);
}

function rewrite_arrow_callback(
	callback: ts.ArrowFunction,
	wrapper: EffectWrapperMember,
	context: RewriteContext,
): void {
	const start = to_expr_pos(callback.getStart(context.source_file), context);
	const end = to_expr_pos(callback.end, context);
	const params_text = context.source_text
		.slice(
			callback.getStart(context.source_file),
			callback.equalsGreaterThanToken.getStart(context.source_file),
		)
		.trim();
	const body_text = get_body_text(callback.body, context);
	const rewritten_body = make_effect_body(callback.body, body_text, wrapper, context);
	const replacement = `${params_text} => ${rewritten_body}`;

	context.magic.overwrite(start, end, replacement);
	context.changed = true;
}

function rewrite_function_body(
	callback: ts.FunctionExpression,
	wrapper: EffectWrapperMember,
	context: RewriteContext,
): void {
	const body_start = to_expr_pos(callback.body.getStart(context.source_file), context);
	const body_end = to_expr_pos(callback.body.end, context);
	const body_text = get_body_text(callback.body, context);
	const rewritten_body = make_effect_body(callback.body, body_text, wrapper, context);

	context.magic.overwrite(body_start, body_end, `{ return ${rewritten_body}; }`);
	context.changed = true;
}

function make_effect_body(
	body: ts.ConciseBody,
	body_text: string,
	wrapper: EffectWrapperMember,
	context: RewriteContext,
): string {
	const wrapper_access = make_effect_access(wrapper, context);

	if (wrapper === "gen") {
		if (ts.isBlock(body)) {
			return `${wrapper_access}(function* () ${body_text})`;
		}

		return `${wrapper_access}(function* () { return (${body_text}); })`;
	}

	if (ts.isBlock(body)) {
		return `${wrapper_access}(() => ${body_text})`;
	}

	return `${wrapper_access}(() => (${body_text}))`;
}

function get_body_text(body: ts.ConciseBody, context: RewriteContext): string {
	return context.source_text.slice(body.getStart(context.source_file), body.end).trim();
}

function get_handler_properties(object_literal: ts.ObjectLiteralExpression): Array<{
	callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
}> {
	return object_literal.properties.flatMap((property) => {
		if (!ts.isPropertyAssignment(property)) {
			return [];
		}

		const name = get_property_name(property.name);

		if (!name || !effectful_handler_property_names.has(name)) {
			return [];
		}

		const callback = is_callback_expression(property.initializer)
			? property.initializer
			: undefined;

		return [{ callback }];
	});
}

function get_last_object_argument(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
	const last_argument = call.arguments[call.arguments.length - 1];

	if (!last_argument || !ts.isObjectLiteralExpression(last_argument)) {
		return undefined;
	}

	return last_argument;
}

function get_effect_member(
	expression: ts.Expression,
	context: RewriteContext,
): EffectMember | undefined {
	if (ts.isIdentifier(expression)) {
		const direct_member = context.bindings.direct_members.get(expression.text);

		if (!direct_member) {
			return undefined;
		}

		return {
			name: direct_member,
			name_start: to_expr_pos(expression.getStart(context.source_file), context),
			name_end: to_expr_pos(expression.end, context),
			direct: true,
		};
	}

	if (!ts.isPropertyAccessExpression(expression)) {
		return undefined;
	}

	if (!is_effect_namespace_expression(expression.expression, context)) {
		return undefined;
	}

	return {
		name: expression.name.text,
		name_start: to_expr_pos(expression.name.getStart(context.source_file), context),
		name_end: to_expr_pos(expression.name.end, context),
		direct: false,
	};
}

function rewrite_effect_member_name(
	member: EffectMember,
	upgraded_name: string,
	context: RewriteContext,
): void {
	if (member.direct) {
		context.magic.overwrite(
			member.name_start,
			member.name_end,
			make_effect_access(upgraded_name, context),
		);

		return;
	}

	context.magic.overwrite(member.name_start, member.name_end, upgraded_name);
}

function make_effect_access(member_name: string, context: RewriteContext): string {
	context.uses_wrapper = true;

	return `${context.bindings.wrapper_expression}.${member_name}`;
}

function is_effect_namespace_expression(
	expression: ts.Expression,
	context: RewriteContext,
): boolean {
	if (ts.isIdentifier(expression)) {
		return (
			context.bindings.effect_object_names.has(expression.text) ||
			context.bindings.effect_module_names.has(expression.text)
		);
	}

	if (!ts.isPropertyAccessExpression(expression)) {
		return false;
	}

	if (expression.name.text !== "Effect") {
		return false;
	}

	if (!ts.isIdentifier(expression.expression)) {
		return false;
	}

	return context.bindings.effect_package_names.has(expression.expression.text);
}

function get_property_name(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
		return name.text;
	}

	return undefined;
}

function is_callback_expression(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression {
	return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function is_non_generator_callback_with_top_level_yield(
	node: ts.Node,
): node is ts.ArrowFunction | ts.FunctionExpression {
	if (!is_callback_expression(node)) {
		return false;
	}

	if (ts.isFunctionExpression(node) && node.asteriskToken) {
		return false;
	}

	return contains_top_level_yield_star(node.body);
}

function is_async_function(node: ts.ArrowFunction | ts.FunctionExpression): boolean {
	return (
		node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false
	);
}

function to_expr_pos(pos: number, context: RewriteContext): number {
	return pos - context.offset;
}
