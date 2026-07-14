import { type AST, parse } from "svelte/compiler";

import ts from "typescript";

export interface SourceRange {
	/** Inclusive start offset. */
	start: number;
	/** Exclusive end offset. */
	end: number;
}

export interface SourceAttribute extends SourceRange {
	/** Attribute name exactly as written in source. */
	name: string;
	/** Inclusive offset where the attribute name starts. */
	name_start: number;
	/** Exclusive offset where the attribute name ends. */
	name_end: number;
	/** Parsed string value when the attribute has one. */
	value?: string | undefined;
}

export interface ScriptRegion extends SourceRange {
	/** Offset where the opening `<script` tag starts. */
	opening_tag_start: number;
	/** Offset immediately after the opening tag's `>` character. */
	opening_tag_end: number;
	/** Offset immediately after the `script` tag name. */
	tag_name_end: number;
	/** Offset where script content starts. */
	content_start: number;
	/** Offset where script content ends. */
	content_end: number;
	/** Offset where the closing `</script>` tag starts. */
	closing_tag_start: number;
	/** Offset immediately after the closing `</script>` tag. */
	closing_tag_end: number;
	/** Raw attribute text between `script` and `>`. */
	attributes_text: string;
	/** Parsed opening tag attributes. */
	attributes: readonly SourceAttribute[];
	/** Script content between the opening and closing tags. */
	text: string;
	/** Whether this is a module script. */
	is_module: boolean;
	/** Whether the script has a `lang` attribute. */
	has_lang: boolean;
	/** Parsed `lang` value when present. */
	lang?: string | undefined;
	/** Whether this script should be parsed as TypeScript. */
	is_typescript: boolean;
	/** Whether this script has SER's `effect` attribute. */
	has_effect: boolean;
	/** Range of the `effect` attribute, including leading whitespace. */
	effect_attribute?: SourceRange | undefined;
}

export interface MarkupBraceExpression {
	/** Offset of the opening `{`. */
	open: number;
	/** Offset of the closing `}`. */
	close: number;
	/** Offset where the expression body starts. */
	inner_start: number;
	/** Offset where the expression body ends. */
	inner_end: number;
	/** Raw expression body between braces. */
	inner: string;
	/** Trimmed expression body. */
	expression_text: string;
	/** Attribute name when the expression is an attribute value. */
	attribute_name?: string | undefined;
}

export interface BareConstDeclarationTag {
	/** Offset of the opening `{`. */
	open: number;
	/** Offset after `{` where `@` should be inserted. */
	insert_position: number;
	/** Brace expression that contains the bare declaration. */
	expression: MarkupBraceExpression;
}

export interface SvelteEffectSourceScan {
	/** Source filename used for diagnostics and debugging. */
	filename: string;
	/** Full component source that was scanned. */
	source: string;
	/** Complete root-level script regions in source order. */
	scripts: readonly ScriptRegion[];
	/** Complete root-level style tag ranges in source order. */
	styles: readonly SourceRange[];
	/** HTML comment ranges in source order. */
	comments: readonly SourceRange[];
	/** Merged ranges where markup brace scanning should not enter. */
	excluded_ranges: readonly SourceRange[];
	/** Markup brace expressions outside excluded ranges. */
	markup_expressions: readonly MarkupBraceExpression[];
	/** Lexical binding names introduced by markup blocks and directives. */
	markup_binding_names: readonly string[];
	/** Bare `{const ...}` tags outside excluded ranges. */
	bare_const_tags: readonly BareConstDeclarationTag[];
	/** First non-module script, if present. */
	instance_script?: ScriptRegion | undefined;
	/** First non-module script with SER's `effect` attribute, if present. */
	effect_script?: ScriptRegion | undefined;
}

interface SourceRegions {
	scripts: ScriptRegion[];
	styles: SourceRange[];
	comments: SourceRange[];
	opaque_ranges: SourceRange[];
	attribute_names: ReadonlyMap<number, string>;
	markup_binding_names: ReadonlySet<string>;
}

interface ParserDiagnostic {
	code?: unknown;
	position?: unknown;
}

interface ParsedSourceFile extends ts.SourceFile {
	parseDiagnostics?: readonly ts.Diagnostic[];
}

type MarkupBindingPattern = NonNullable<AST.EachBlock["context"]>;

interface LocatedRawTag extends SourceRange {
	name: "script" | "style";
	content_start: number;
	content_end: number;
}

let latest_scan: SvelteEffectSourceScan | undefined;

function parse_svelte_source(source: string): AST.Root | undefined {
	let parse_source = source;
	const yield_count = source.match(/\byield\s*\*/g)?.length ?? 0;
	const max_attempts = yield_count + 1;

	for (let attempt = 0; attempt < max_attempts; attempt += 1) {
		try {
			return parse(parse_source, { modern: true, loose: true });
		} catch (error) {
			const normalized = normalize_parser_error(parse_source, error);

			if (!normalized || normalized === parse_source) {
				return undefined;
			}

			parse_source = normalized;
		}
	}

	return undefined;
}

function normalize_parser_error(source: string, error: unknown): string | undefined {
	if (!is_parser_diagnostic(error) || !is_parser_position(error.position)) {
		return undefined;
	}

	const [start, end] = error.position;

	if (error.code === "js_parse_error") {
		const match = source.slice(start).match(/^yield\s*\*/);

		if (!match) {
			return undefined;
		}

		return replace_range(source, start, start + match[0].length, blank_source(match[0]));
	}

	if (error.code !== "render_tag_invalid_expression") {
		return undefined;
	}

	const expression = source.slice(start, end);
	const yield_index = expression.search(/\byield\s*\*/);

	if (yield_index === -1) {
		return undefined;
	}

	return normalize_render_yield_expressions(source);
}

function normalize_render_yield_expressions(source: string): string {
	const replacements: Array<SourceRange & { text: string }> = [];
	let cursor = 0;

	while (cursor < source.length) {
		const open = source.indexOf("{@render", cursor);

		if (open === -1) {
			break;
		}

		const close = find_closing_brace(source, open);

		if (close === -1) {
			cursor = open + 1;
			continue;
		}

		const tag = source.slice(open + 1, close);
		const prefix = tag.match(/^@render\b\s*/)?.[0];
		const expression_start = prefix ? open + 1 + prefix.length : -1;
		const expression = expression_start === -1 ? "" : source.slice(expression_start, close);

		if (/\byield\s*\*/.test(expression)) {
			const blanked = blank_source(expression);

			replacements.push({
				start: expression_start,
				end: close,
				text: "x()" + blanked.slice(3),
			});
		}

		cursor = close + 1;
	}

	if (replacements.length === 0) {
		return source;
	}

	const parts: string[] = [];
	let source_cursor = 0;

	for (const replacement of replacements) {
		parts.push(source.slice(source_cursor, replacement.start), replacement.text);
		source_cursor = replacement.end;
	}

	parts.push(source.slice(source_cursor));

	return parts.join("");
}

function is_parser_diagnostic(error: unknown): error is ParserDiagnostic {
	return typeof error === "object" && error !== null;
}

function is_parser_position(position: unknown): position is [number, number] {
	return (
		Array.isArray(position) &&
		position.length === 2 &&
		position.every((offset) => typeof offset === "number")
	);
}

function replace_range(source: string, start: number, end: number, replacement: string): string {
	return source.slice(0, start) + replacement + source.slice(end);
}

function blank_source(source: string): string {
	return source.replace(/[^\r\n]/g, " ");
}

export function scan_svelte_effect_source(
	source: string,
	filename = "unknown.svelte",
): SvelteEffectSourceScan {
	if (latest_scan?.source === source && latest_scan.filename === filename) {
		return latest_scan;
	}

	const scan = scan_svelte_effect_source_uncached(source, filename);

	latest_scan = scan;

	return scan;
}

function scan_svelte_effect_source_uncached(
	source: string,
	filename: string,
): SvelteEffectSourceScan {
	const fast_regions = collect_fast_source_regions(source);

	if (fast_regions) {
		return make_source_scan(source, filename, fast_regions);
	}

	const parse_source = make_svelte_parse_shadow(source);
	const ast = parse_svelte_source(parse_source);

	if (!ast) {
		return make_opaque_scan(source, filename);
	}

	const regions = collect_source_regions(source, ast);

	return make_source_scan(source, filename, regions);
}

function make_source_scan(
	source: string,
	filename: string,
	regions: SourceRegions,
): SvelteEffectSourceScan {
	const scripts = regions.scripts;
	const styles = regions.styles;
	const comments = regions.comments;
	const excluded_ranges = merge_ranges([...comments, ...regions.opaque_ranges]);
	const markup_expressions = collect_scanned_markup_expressions(
		source,
		excluded_ranges,
		regions.attribute_names,
	);
	const bare_const_tags = markup_expressions.flatMap((expression) =>
		make_bare_const_tag(expression),
	);
	const instance_script = scripts.find((script) => !script.is_module);
	const effect_script = scripts.find((script) => !script.is_module && script.has_effect);

	return {
		filename,
		source,
		scripts,
		styles,
		comments,
		excluded_ranges,
		markup_expressions,
		markup_binding_names: [...regions.markup_binding_names],
		bare_const_tags,
		instance_script,
		effect_script,
	};
}

function make_opaque_scan(source: string, filename: string): SvelteEffectSourceScan {
	return {
		filename,
		source,
		scripts: [],
		styles: [],
		comments: [],
		excluded_ranges: source.length === 0 ? [] : [{ start: 0, end: source.length }],
		markup_expressions: [],
		markup_binding_names: [],
		bare_const_tags: [],
		instance_script: undefined,
		effect_script: undefined,
	};
}

/** Reuses scan offsets after bare-const normalization inserts characters. */
export function shift_scan_after_at_insertions(
	scan: SvelteEffectSourceScan,
	normalized_source: string,
	insert_positions: readonly number[],
): SvelteEffectSourceScan {
	const inserts = [...insert_positions].sort((left, right) => left - right);
	const shift = (offset: number) => offset + count_insertions_at_or_before(inserts, offset);

	const shift_range = <T extends SourceRange>(range: T): T => ({
		...range,
		start: shift(range.start),
		end: shift(range.end),
	});

	const shift_attribute = (attribute: SourceAttribute): SourceAttribute => ({
		...shift_range(attribute),
		name: attribute.name,
		name_start: shift(attribute.name_start),
		name_end: shift(attribute.name_end),
		value: attribute.value,
	});

	const shift_script = (script: ScriptRegion): ScriptRegion => {
		const shifted = {
			...shift_range(script),
			opening_tag_start: shift(script.opening_tag_start),
			opening_tag_end: shift(script.opening_tag_end),
			tag_name_end: shift(script.tag_name_end),
			content_start: shift(script.content_start),
			content_end: shift(script.content_end),
			closing_tag_start: shift(script.closing_tag_start),
			closing_tag_end: shift(script.closing_tag_end),
			attributes_text: normalized_source.slice(
				shift(script.tag_name_end),
				shift(script.opening_tag_end) - 1,
			),
			attributes: script.attributes.map(shift_attribute),
			text: normalized_source.slice(shift(script.content_start), shift(script.content_end)),
			is_module: script.is_module,
			has_lang: script.has_lang,
			lang: script.lang,
			is_typescript: script.is_typescript,
			has_effect: script.has_effect,
			effect_attribute: script.effect_attribute
				? shift_range(script.effect_attribute)
				: undefined,
		};

		return shifted;
	};

	const shift_expression = (expression: MarkupBraceExpression): MarkupBraceExpression => {
		const open = shift(expression.open);
		const close = shift(expression.close);
		const inner_start = shift(expression.inner_start);
		const inner_end = shift(expression.inner_end);
		const inner = normalized_source.slice(inner_start, inner_end);

		return {
			open,
			close,
			inner_start,
			inner_end,
			inner,
			expression_text: inner.trim(),
			attribute_name: expression.attribute_name,
		};
	};

	const scripts = scan.scripts.map(shift_script);

	return {
		filename: scan.filename,
		source: normalized_source,
		scripts,
		styles: scan.styles.map(shift_range),
		comments: scan.comments.map(shift_range),
		excluded_ranges: scan.excluded_ranges.map(shift_range),
		markup_expressions: scan.markup_expressions.map(shift_expression),
		markup_binding_names: scan.markup_binding_names,
		bare_const_tags: [],
		instance_script: scan.instance_script ? shift_script(scan.instance_script) : undefined,
		effect_script: scan.effect_script ? shift_script(scan.effect_script) : undefined,
	};
}

function count_insertions_at_or_before(
	insert_positions: readonly number[],
	offset: number,
): number {
	let low = 0;
	let high = insert_positions.length;

	while (low < high) {
		const middle = Math.floor((low + high) / 2);

		if ((insert_positions[middle] ?? Infinity) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}

	return low;
}

function collect_fast_source_regions(source: string): SourceRegions | undefined {
	const element_stack: string[] = [];
	const scripts: ScriptRegion[] = [];
	const styles: SourceRange[] = [];
	const comments: SourceRange[] = [];
	const opaque_ranges: SourceRange[] = [];
	let optional_element_count = 0;
	let cursor = 0;

	while (cursor < source.length) {
		if (source.startsWith("<!--", cursor)) {
			const close = source.indexOf("-->", cursor + 4);

			if (close === -1) {
				return undefined;
			}

			const comment = { start: cursor, end: close + 3 };

			comments.push(comment);
			cursor = comment.end;
			continue;
		}

		const char = source[cursor];

		if (char === "&") {
			return undefined;
		}

		if (char === "{") {
			const close = find_fast_closing_brace(source, cursor);

			if (close === -1 || /^\s*[#/:@]/.test(source.slice(cursor + 1, close))) {
				return undefined;
			}

			cursor = close + 1;
			continue;
		}

		if (char !== "<") {
			cursor += 1;
			continue;
		}

		const raw_name = read_raw_opening_name(source, cursor);

		if (raw_name) {
			if (element_stack.length > 0) {
				return undefined;
			}

			const raw_tag = locate_raw_tag(source, cursor, raw_name);

			if (!raw_tag || !is_fast_raw_opening(source, raw_tag)) {
				return undefined;
			}

			if (raw_name === "script") {
				if (scripts.length > 0) {
					return undefined;
				}

				scripts.push(make_fast_script_region(source, raw_tag));
			} else {
				if (styles.length > 0) {
					return undefined;
				}

				styles.push({ start: raw_tag.start, end: raw_tag.end });
			}

			opaque_ranges.push({ start: raw_tag.start, end: raw_tag.end });
			cursor = raw_tag.end;
			continue;
		}

		const tag = read_fast_ordinary_tag(source, cursor);

		if (!tag) {
			return undefined;
		}

		if (tag.is_closing) {
			if (fast_void_tag_names.has(tag.name) || element_stack.at(-1) !== tag.name) {
				return undefined;
			}

			element_stack.pop();

			if (fast_optional_end_tag_names.has(tag.name)) {
				optional_element_count -= 1;
			}
		} else if (!tag.is_self_closing && !fast_void_tag_names.has(tag.name)) {
			if (optional_element_count > 0) {
				return undefined;
			}

			element_stack.push(tag.name);

			if (fast_optional_end_tag_names.has(tag.name)) {
				optional_element_count += 1;
			}
		}

		cursor = tag.end;
	}

	if (element_stack.length > 0) {
		return undefined;
	}

	return {
		scripts,
		styles,
		comments,
		opaque_ranges,
		attribute_names: new Map(),
		markup_binding_names: new Set(),
	};
}

const fast_void_tag_names = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

const fast_optional_end_tag_names = new Set([
	"colgroup",
	"dd",
	"dt",
	"li",
	"optgroup",
	"option",
	"p",
	"rp",
	"rt",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
]);

function read_fast_ordinary_tag(
	source: string,
	start: number,
): { name: string; end: number; is_closing: boolean; is_self_closing: boolean } | undefined {
	let cursor = start + 1;
	const is_closing = source[cursor] === "/";

	if (is_closing) {
		cursor += 1;
	}

	const name_start = cursor;

	if (!/[a-z]/.test(source[cursor] ?? "")) {
		return undefined;
	}

	while (/[a-z0-9-]/.test(source[cursor] ?? "")) {
		cursor += 1;
	}

	const name = source.slice(name_start, cursor);

	while (/\s/.test(source[cursor] ?? "")) {
		cursor += 1;
	}

	const is_self_closing = !is_closing && source[cursor] === "/";

	if (is_self_closing) {
		cursor += 1;
	}

	if (source[cursor] !== ">") {
		return undefined;
	}

	return { name, end: cursor + 1, is_closing, is_self_closing };
}

function find_fast_closing_brace(source: string, open: number): number {
	let depth = 1;
	let cursor = open + 1;

	while (cursor < source.length) {
		const char = source[cursor];

		if (char === "'" || char === '"') {
			const close = skip_quoted_string(source, cursor, char);

			if (close === -1) {
				return -1;
			}

			cursor = close + 1;
			continue;
		}

		if (char === "`" || char === "/") {
			return -1;
		}

		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;

			if (depth === 0) {
				return cursor;
			}
		}

		cursor += 1;
	}

	return -1;
}

function read_raw_opening_name(source: string, start: number): "script" | "style" | undefined {
	for (const name of ["script", "style"] as const) {
		const name_end = start + name.length + 1;

		if (
			source.startsWith(`<${name}`, start) &&
			(source[name_end] === ">" || /\s/.test(source[name_end] ?? ""))
		) {
			return name;
		}
	}

	return undefined;
}

function locate_raw_tag(
	source: string,
	start: number,
	name: "script" | "style",
): LocatedRawTag | undefined {
	const content_start = find_static_opening_tag_end(source, start, name);

	if (content_start === -1) {
		return undefined;
	}

	const opening_tag = source.slice(start, content_start);
	const is_preprocessor_style = name === "style" && has_style_lang_attribute(opening_tag);
	const parsed_style_end =
		name === "style"
			? find_style_closing_tag(source, content_start, is_preprocessor_style)
			: undefined;
	const content_end =
		name === "script"
			? find_raw_closing_tag(source, content_start, name)
			: (parsed_style_end ??
				(is_preprocessor_style
					? find_raw_closing_tag(source, content_start, name)
					: undefined));

	if (!content_end) {
		return undefined;
	}

	return {
		name,
		start,
		end: content_end.end,
		content_start,
		content_end: content_end.start,
	};
}

function has_style_lang_attribute(opening_tag: string): boolean {
	try {
		const ast = parse(`${opening_tag}</style>`, { modern: true, loose: true });

		return (
			ast.css?.attributes.some((attribute) => attribute.name.toLowerCase() === "lang") ??
			false
		);
	} catch {
		return false;
	}
}

function find_raw_closing_tag(
	source: string,
	start: number,
	name: "script" | "style",
): SourceRange | undefined {
	let cursor = start;

	while (cursor < source.length) {
		const closing_start = source.indexOf(`</${name}`, cursor);

		if (closing_start === -1) {
			return undefined;
		}

		const closing_end = find_closing_tag_end_at(source, closing_start, name, false);

		if (closing_end !== undefined) {
			return { start: closing_start, end: closing_end };
		}

		cursor = closing_start + name.length + 2;
	}

	return undefined;
}

function find_static_opening_tag_end(
	source: string,
	start: number,
	name: "script" | "style",
): number {
	let cursor = start + name.length + 1;
	let quote: string | undefined;

	while (cursor < source.length) {
		const char = source[cursor];

		if (quote) {
			if (char === quote) {
				quote = undefined;
			}

			cursor += 1;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			cursor += 1;
			continue;
		}

		if (
			char === "{" ||
			char === "}" ||
			char === "<" ||
			source.startsWith("/*", cursor) ||
			source.startsWith("//", cursor)
		) {
			return -1;
		}

		if (char === ">") {
			return source.slice(start, cursor).trimEnd().endsWith("/") ? -1 : cursor + 1;
		}

		cursor += 1;
	}

	return -1;
}

function find_style_closing_tag(
	source: string,
	start: number,
	skip_line_comments: boolean,
): SourceRange | undefined {
	let cursor = start;

	while (cursor < source.length) {
		const char = source[cursor];
		const identifier_end = skip_line_comments
			? find_css_identifier_end(source, cursor)
			: undefined;

		if (identifier_end !== undefined) {
			const url_end = skip_css_url(source, cursor, identifier_end);

			if (url_end === -1) {
				return undefined;
			}

			cursor = url_end === undefined ? identifier_end : url_end + 1;
			continue;
		}

		if (char === '"' || char === "'") {
			const close = skip_quoted_string(source, cursor, char);

			if (close === -1) {
				return undefined;
			}

			cursor = close + 1;
			continue;
		}

		if (source.startsWith("/*", cursor)) {
			const close = skip_block_comment(source, cursor);

			if (close === -1) {
				return undefined;
			}

			cursor = close + 1;
			continue;
		}

		if (skip_line_comments && source.startsWith("//", cursor)) {
			cursor = skip_line_comment(source, cursor) + 1;
			continue;
		}

		const closing_end = find_closing_tag_end_at(source, cursor, "style", false);

		if (closing_end !== undefined) {
			return { start: cursor, end: closing_end };
		}

		cursor += 1;
	}

	return undefined;
}

function find_css_identifier_end(source: string, start: number): number | undefined {
	const first = source[start];

	if (!is_css_identifier_start(first)) {
		return undefined;
	}

	let cursor = start;

	while (cursor < source.length) {
		const char = source[cursor];

		if (is_css_identifier_character(char)) {
			cursor += 1;
			continue;
		}

		if (char === "\\") {
			cursor = skip_css_escape(source, cursor);
			continue;
		}

		break;
	}

	return cursor;
}

function skip_css_url(source: string, start: number, identifier_end: number): number | undefined {
	if (source.slice(start, identifier_end).toLowerCase() !== "url") {
		return undefined;
	}

	let cursor = skip_css_whitespace(source, identifier_end);

	if (source[cursor] !== "(") {
		return undefined;
	}

	cursor = skip_css_whitespace(source, cursor + 1);

	const quote = source[cursor];

	if (quote === '"' || quote === "'") {
		const close = skip_quoted_string(source, cursor, quote);

		if (close === -1) {
			return -1;
		}

		cursor = skip_css_url_trivia(source, close + 1);

		if (cursor === -1) {
			return -1;
		}

		return source[cursor] === ")" ? cursor : -1;
	}

	while (cursor < source.length) {
		const char = source[cursor];

		if (char === "\\") {
			cursor = skip_css_escape(source, cursor);
			continue;
		}

		if (char === ")") {
			return cursor;
		}

		cursor += 1;
	}

	return -1;
}

function skip_css_whitespace(source: string, start: number): number {
	let cursor = start;

	while (cursor < source.length && /[\t\n\f\r ]/.test(source[cursor] ?? "")) {
		cursor += 1;
	}

	return cursor;
}

function skip_css_url_trivia(source: string, start: number): number {
	let cursor = start;

	while (cursor < source.length) {
		cursor = skip_css_whitespace(source, cursor);

		if (!source.startsWith("/*", cursor)) {
			return cursor;
		}

		const close = skip_block_comment(source, cursor);

		if (close === -1) {
			return -1;
		}

		cursor = close + 1;
	}

	return cursor;
}

function skip_css_escape(source: string, start: number): number {
	return Math.min(start + 2, source.length);
}

function is_css_identifier_start(char: string | undefined): boolean {
	return (
		char !== undefined &&
		(/[A-Za-z_-]/.test(char) || char === "\\" || char.charCodeAt(0) >= 0x80)
	);
}

function is_css_identifier_character(char: string | undefined): boolean {
	return char !== undefined && (/[A-Za-z0-9_-]/.test(char) || char.charCodeAt(0) >= 0x80);
}

function is_fast_raw_opening(source: string, raw_tag: LocatedRawTag): boolean {
	const opening = source.slice(raw_tag.start, raw_tag.content_start);

	if (raw_tag.name === "script") {
		return opening === "<script>";
	}

	return /^<style(?:\s+lang=(?:"[A-Za-z0-9_-]+"|'[A-Za-z0-9_-]+'|[A-Za-z0-9_-]+))?\s*>$/.test(
		opening,
	);
}

function make_fast_script_region(source: string, raw_tag: LocatedRawTag): ScriptRegion {
	return {
		start: raw_tag.start,
		end: raw_tag.end,
		opening_tag_start: raw_tag.start,
		opening_tag_end: raw_tag.content_start,
		tag_name_end: raw_tag.start + "<script".length,
		content_start: raw_tag.content_start,
		content_end: raw_tag.content_end,
		closing_tag_start: raw_tag.content_end,
		closing_tag_end: raw_tag.end,
		attributes_text: "",
		attributes: [],
		text: source.slice(raw_tag.content_start, raw_tag.content_end),
		is_module: false,
		has_lang: false,
		lang: undefined,
		is_typescript: false,
		has_effect: false,
		effect_attribute: undefined,
	};
}

function make_svelte_parse_shadow(source: string): string {
	const raw_tags = collect_shadow_raw_tags(source);

	if (!raw_tags) {
		return source;
	}

	const parts: string[] = [];
	let cursor = 0;

	for (const raw_tag of raw_tags) {
		parts.push(source.slice(cursor, raw_tag.content_start));
		parts.push(blank_source(source.slice(raw_tag.content_start, raw_tag.content_end)));
		cursor = raw_tag.content_end;
	}

	parts.push(source.slice(cursor));

	return normalize_markup_yield_operators(parts.join(""));
}

function normalize_markup_yield_operators(source: string): string {
	const replacements: Array<SourceRange & { text: string }> = [];
	let cursor = 0;

	while (cursor < source.length) {
		const open = source.indexOf("{", cursor);

		if (open === -1) {
			break;
		}

		const close = find_closing_brace(source, open);

		if (close === -1) {
			cursor = open + 1;
			continue;
		}

		const inner = source.slice(open + 1, close);
		const trimmed = inner.trimStart();

		if (!/\byield\s*\*/.test(inner) || /^@debug\b/.test(trimmed)) {
			cursor = close + 1;
			continue;
		}

		const render_prefix = inner.match(/^(\s*@render\b\s*)/)?.[0];
		const text = render_prefix
			? render_prefix + "x()" + blank_source(inner.slice(render_prefix.length)).slice(3)
			: inner.replace(/\byield\s*\*/g, blank_source);

		replacements.push({ start: open + 1, end: close, text });
		cursor = close + 1;
	}

	if (replacements.length === 0) {
		return source;
	}

	const parts: string[] = [];
	let source_cursor = 0;

	for (const replacement of replacements) {
		parts.push(source.slice(source_cursor, replacement.start), replacement.text);
		source_cursor = replacement.end;
	}

	parts.push(source.slice(source_cursor));

	return parts.join("");
}

function collect_shadow_raw_tags(source: string): LocatedRawTag[] | undefined {
	const raw_tags: LocatedRawTag[] = [];
	let cursor = 0;

	while (cursor < source.length) {
		if (source.startsWith("<!--", cursor)) {
			const close = source.indexOf("-->", cursor + 4);

			if (close === -1) {
				return undefined;
			}

			cursor = close + 3;
			continue;
		}

		const char = source[cursor];

		if (char === "{") {
			const close = find_closing_brace(source, cursor);

			if (close === -1) {
				return undefined;
			}

			cursor = close + 1;
			continue;
		}

		if (char !== "<") {
			cursor += 1;
			continue;
		}

		const rcdata_name = read_rcdata_opening_name(source, cursor);

		if (rcdata_name) {
			const content_start = find_markup_tag_end(source, cursor);
			const closing_tag =
				content_start === -1
					? undefined
					: find_rcdata_closing_tag(source, content_start, rcdata_name);

			if (!closing_tag) {
				return undefined;
			}

			cursor = closing_tag.end;
			continue;
		}

		const raw_name = read_raw_opening_name(source, cursor);

		if (raw_name) {
			const raw_tag = locate_raw_tag(source, cursor, raw_name);

			if (!raw_tag) {
				return undefined;
			}

			raw_tags.push(raw_tag);
			cursor = raw_tag.end;
			continue;
		}

		const tag_end = find_markup_tag_end(source, cursor);

		if (tag_end === -1) {
			return undefined;
		}

		cursor = tag_end;
	}

	return raw_tags;
}

function read_rcdata_opening_name(source: string, start: number): "textarea" | "title" | undefined {
	for (const name of ["textarea", "title"] as const) {
		const name_end = start + name.length + 1;
		const opening_name = source.slice(start, name_end).toLowerCase();

		if (
			opening_name === `<${name}` &&
			(source[name_end] === ">" || /\s/.test(source[name_end] ?? ""))
		) {
			return name;
		}
	}

	return undefined;
}

function find_rcdata_closing_tag(
	source: string,
	start: number,
	name: "textarea" | "title",
): SourceRange | undefined {
	let cursor = start;

	while (cursor < source.length) {
		if (source[cursor] === "{") {
			const close = find_closing_brace(source, cursor);

			if (close === -1) {
				return undefined;
			}

			cursor = close + 1;
			continue;
		}

		const closing_end = find_closing_tag_end_at(source, cursor, name, true);

		if (closing_end !== undefined) {
			return { start: cursor, end: closing_end };
		}

		cursor += 1;
	}

	return undefined;
}

function find_closing_tag_end_at(
	source: string,
	start: number,
	name: string,
	case_insensitive: boolean,
): number | undefined {
	if (source[start] !== "<") {
		return undefined;
	}

	const prefix = source.slice(start, start + name.length + 2);
	const expected = `</${name}`;
	const matches = case_insensitive ? prefix.toLowerCase() === expected : prefix === expected;

	if (!matches) {
		return undefined;
	}

	let cursor = start + expected.length;

	while (/\s/.test(source[cursor] ?? "")) {
		cursor += 1;
	}

	return source[cursor] === ">" ? cursor + 1 : undefined;
}

function find_markup_tag_end(source: string, start: number): number {
	let cursor = start + 1;
	let quote: string | undefined;

	while (cursor < source.length) {
		const char = source[cursor];

		if (quote) {
			if (char === quote) {
				quote = undefined;
			}

			cursor += 1;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			cursor += 1;
			continue;
		}

		if (char === "{") {
			const close = find_closing_brace(source, cursor);

			if (close === -1) {
				return -1;
			}

			cursor = close + 1;
			continue;
		}

		if (source.startsWith("/*", cursor)) {
			const close = skip_block_comment(source, cursor);

			if (close === -1) {
				return -1;
			}

			cursor = close + 1;
			continue;
		}

		if (source.startsWith("//", cursor)) {
			cursor = skip_line_comment(source, cursor) + 1;
			continue;
		}

		if (char === ">") {
			return cursor + 1;
		}

		if (char === "<") {
			return -1;
		}

		cursor += 1;
	}

	return -1;
}

function collect_source_regions(source: string, ast: AST.Root): SourceRegions {
	const scripts = [ast.module, ast.instance]
		.filter((script): script is AST.Script => script != null)
		.map((script) => make_ast_script_region(source, script))
		.sort((left, right) => left.start - right.start);
	const styles = ast.css ? [{ start: ast.css.start, end: ast.css.end }] : [];
	const comments: SourceRange[] = [];
	const opaque_ranges: SourceRange[] = [
		...scripts.map(({ start, end }) => ({ start, end })),
		...styles,
		...ast.comments.map(({ start, end }) => ({ start, end })),
	];
	const attribute_names = new Map<number, string>();
	const markup_binding_names = new Set<string>();

	collect_fragment_regions(
		source,
		ast.fragment,
		comments,
		opaque_ranges,
		attribute_names,
		markup_binding_names,
	);

	return {
		scripts,
		styles,
		comments,
		opaque_ranges,
		attribute_names,
		markup_binding_names,
	};
}

function collect_fragment_regions(
	source: string,
	fragment: AST.Fragment,
	comments: SourceRange[],
	opaque_ranges: SourceRange[],
	attribute_names: Map<number, string>,
	markup_binding_names: Set<string>,
): void {
	for (const node of fragment.nodes) {
		if (node.type === "Comment") {
			comments.push({ start: node.start, end: node.end });
			continue;
		}

		if (node.type === "RegularElement" && (node.name === "script" || node.name === "style")) {
			opaque_ranges.push({ start: node.start, end: node.end });
			continue;
		}

		collect_node_markup_binding_names(node, markup_binding_names);
		collect_node_attribute_names(source, node, attribute_names, markup_binding_names);
		collect_node_fragments(
			source,
			node,
			comments,
			opaque_ranges,
			attribute_names,
			markup_binding_names,
		);
	}
}

function collect_node_markup_binding_names(
	node: AST.Fragment["nodes"][number],
	markup_binding_names: Set<string>,
): void {
	switch (node.type) {
		case "EachBlock":
			if (node.context) {
				collect_markup_binding_pattern_names(node.context, markup_binding_names);
			}

			if (node.index) {
				markup_binding_names.add(node.index);
			}

			return;

		case "AwaitBlock":
			for (const pattern of [node.value, node.error]) {
				if (pattern) {
					collect_markup_binding_pattern_names(pattern, markup_binding_names);
				}
			}

			return;

		case "SnippetBlock":
			markup_binding_names.add(node.expression.name);

			for (const parameter of node.parameters) {
				collect_markup_binding_pattern_names(parameter, markup_binding_names);
			}

			return;

		case "ConstTag":
		case "DeclarationTag":
			for (const declaration of node.declaration.declarations) {
				collect_markup_binding_pattern_names(declaration.id, markup_binding_names);
			}

			return;

		default:
			return;
	}
}

function collect_markup_binding_pattern_names(
	pattern: MarkupBindingPattern,
	markup_binding_names: Set<string>,
): void {
	switch (pattern.type) {
		case "Identifier":
			markup_binding_names.add(pattern.name);
			return;

		case "ArrayPattern":
			for (const element of pattern.elements) {
				if (element) {
					collect_markup_binding_pattern_names(element, markup_binding_names);
				}
			}

			return;

		case "ObjectPattern":
			for (const property of pattern.properties) {
				const value = property.type === "RestElement" ? property.argument : property.value;

				collect_markup_binding_pattern_names(value, markup_binding_names);
			}

			return;

		case "RestElement":
			collect_markup_binding_pattern_names(pattern.argument, markup_binding_names);
			return;

		case "AssignmentPattern":
			collect_markup_binding_pattern_names(pattern.left, markup_binding_names);
			return;

		case "MemberExpression":
			return;
	}
}

function collect_node_fragments(
	source: string,
	node: AST.Fragment["nodes"][number],
	comments: SourceRange[],
	opaque_ranges: SourceRange[],
	attribute_names: Map<number, string>,
	markup_binding_names: Set<string>,
): void {
	if ("fragment" in node) {
		collect_fragment_regions(
			source,
			node.fragment,
			comments,
			opaque_ranges,
			attribute_names,
			markup_binding_names,
		);
	}

	switch (node.type) {
		case "IfBlock":
			collect_fragment_regions(
				source,
				node.consequent,
				comments,
				opaque_ranges,
				attribute_names,
				markup_binding_names,
			);

			if (node.alternate) {
				collect_fragment_regions(
					source,
					node.alternate,
					comments,
					opaque_ranges,
					attribute_names,
					markup_binding_names,
				);
			}

			return;

		case "EachBlock":
			collect_fragment_regions(
				source,
				node.body,
				comments,
				opaque_ranges,
				attribute_names,
				markup_binding_names,
			);

			if (node.fallback) {
				collect_fragment_regions(
					source,
					node.fallback,
					comments,
					opaque_ranges,
					attribute_names,
					markup_binding_names,
				);
			}

			return;

		case "AwaitBlock":
			for (const branch of [node.pending, node.then, node.catch]) {
				if (branch) {
					collect_fragment_regions(
						source,
						branch,
						comments,
						opaque_ranges,
						attribute_names,
						markup_binding_names,
					);
				}
			}

			return;

		case "SnippetBlock":
			collect_fragment_regions(
				source,
				node.body,
				comments,
				opaque_ranges,
				attribute_names,
				markup_binding_names,
			);
			return;

		default:
			return;
	}
}

function collect_node_attribute_names(
	source: string,
	node: AST.Fragment["nodes"][number],
	attribute_names: Map<number, string>,
	markup_binding_names: Set<string>,
): void {
	if (!("attributes" in node)) {
		return;
	}

	for (const attribute of node.attributes) {
		if (attribute.type === "LetDirective" && attribute.expression === null) {
			markup_binding_names.add(attribute.name);
			continue;
		}

		if (attribute.type === "Attribute") {
			collect_attribute_value_names(attribute.value, attribute.name, attribute_names);
			continue;
		}

		if (attribute.type === "StyleDirective") {
			const source_name = read_source_attribute_name(source, attribute.start, attribute.end);

			if (source_name) {
				collect_attribute_value_names(attribute.value, source_name, attribute_names);
			}

			continue;
		}

		if (!("expression" in attribute) || !attribute.expression) {
			continue;
		}

		const open = source.indexOf("{", attribute.start);

		if (open < attribute.start || open >= attribute.end) {
			continue;
		}

		const source_name = read_source_attribute_name(source, attribute.start, attribute.end);

		if (source_name && source.slice(attribute.start, open).includes("=")) {
			attribute_names.set(open, source_name);
		}
	}
}

function collect_attribute_value_names(
	value: AST.Attribute["value"],
	attribute_name: string,
	attribute_names: Map<number, string>,
): void {
	if (value === true) {
		return;
	}

	const parts = Array.isArray(value) ? value : [value];
	const expression = parts.length === 1 ? parts[0] : undefined;

	if (expression?.type !== "ExpressionTag") {
		return;
	}

	attribute_names.set(expression.start, attribute_name);
}

function read_source_attribute_name(
	source: string,
	start: number,
	end: number,
): string | undefined {
	return source.slice(start, end).match(/^[^\s=]+/)?.[0];
}

function make_ast_script_region(source: string, script: AST.Script): ScriptRegion {
	const tag_name_end = script.start + "<script".length;
	const attributes = collect_ast_script_attributes(source, script, tag_name_end);
	const content_start = get_program_offset(script.content, "start");
	const content_end = get_program_offset(script.content, "end");
	const lang = get_attribute(attributes, "lang")?.value?.toLowerCase();
	const effect_attribute = get_attribute(attributes, "effect");

	return {
		start: script.start,
		end: script.end,
		opening_tag_start: script.start,
		opening_tag_end: content_start,
		tag_name_end,
		content_start,
		content_end,
		closing_tag_start: content_end,
		closing_tag_end: script.end,
		attributes_text: source.slice(tag_name_end, content_start - 1),
		attributes,
		text: source.slice(content_start, content_end),
		is_module: script.context === "module",
		has_lang: get_attribute(attributes, "lang") !== undefined,
		lang,
		is_typescript: lang === "ts" || lang === "typescript",
		has_effect: effect_attribute !== undefined,
		effect_attribute: effect_attribute
			? { start: effect_attribute.start, end: effect_attribute.end }
			: undefined,
	};
}

function get_program_offset(program: AST.Script["content"], key: "start" | "end"): number {
	if (key === "start" && "start" in program && typeof program.start === "number") {
		return program.start;
	}

	if (key === "end" && "end" in program && typeof program.end === "number") {
		return program.end;
	}

	throw new Error(`Svelte script content has no ${key} offset`);
}

function collect_ast_script_attributes(
	source: string,
	script: AST.Script,
	tag_name_end: number,
): SourceAttribute[] {
	let previous_end = tag_name_end;

	return script.attributes.map((attribute) => {
		const name_start = attribute.start;
		const source_name = read_source_attribute_name(source, attribute.start, attribute.end);
		const name_end = name_start + (source_name?.length ?? attribute.name.length);
		let start = attribute.start;

		while (start > previous_end && /\s/.test(source[start - 1] ?? "")) {
			start -= 1;
		}

		previous_end = attribute.end;

		return {
			name: source_name ?? attribute.name,
			start,
			end: attribute.end,
			name_start,
			name_end,
			value: get_static_attribute_value(attribute.value),
		};
	});
}

function get_static_attribute_value(value: AST.Attribute["value"]): string | undefined {
	if (value === true) {
		return undefined;
	}

	const parts = Array.isArray(value) ? value : [value];

	if (!parts.every((part): part is AST.Text => part.type === "Text")) {
		return undefined;
	}

	return parts.map((part) => part.data).join("");
}

function collect_scanned_markup_expressions(
	source: string,
	excluded_ranges: readonly SourceRange[],
	attribute_names: ReadonlyMap<number, string>,
): MarkupBraceExpression[] {
	const expressions: MarkupBraceExpression[] = [];
	let cursor = 0;

	while (cursor < source.length) {
		const open = source.indexOf("{", cursor);

		if (open === -1) {
			break;
		}

		const excluded_range = find_range_containing(excluded_ranges, open);

		if (excluded_range) {
			cursor = excluded_range.end;
			continue;
		}

		const close = find_closing_brace(source, open);

		if (close === -1) {
			cursor = open + 1;
			continue;
		}

		const inner_start = open + 1;
		const inner_end = close;
		const inner = source.slice(inner_start, inner_end);

		expressions.push({
			open,
			close,
			inner_start,
			inner_end,
			inner,
			expression_text: inner.trim(),
			attribute_name: attribute_names.get(open),
		});

		cursor = close + 1;
	}

	return expressions;
}

function find_range_containing(
	ranges: readonly SourceRange[],
	position: number,
): SourceRange | undefined {
	let low = 0;
	let high = ranges.length - 1;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const range = ranges[mid];

		if (position < range.start) {
			high = mid - 1;
			continue;
		}

		if (position >= range.end) {
			low = mid + 1;
			continue;
		}

		return range;
	}

	return undefined;
}

function make_bare_const_tag(
	expression: MarkupBraceExpression,
): readonly BareConstDeclarationTag[] {
	if (!/^(\s*)const\s/.test(expression.inner)) {
		return [];
	}

	return [
		{
			open: expression.open,
			insert_position: expression.open + 1,
			expression,
		},
	];
}

function merge_ranges(ranges: SourceRange[]): SourceRange[] {
	const sorted = [...ranges].sort((a, b) => a.start - b.start);
	const merged: SourceRange[] = [];

	for (const range of sorted) {
		const previous = merged.at(-1);

		if (!previous || range.start > previous.end) {
			merged.push({ ...range });
			continue;
		}

		previous.end = Math.max(previous.end, range.end);
	}

	return merged;
}

function get_attribute(
	attributes: readonly SourceAttribute[],
	name: string,
): SourceAttribute | undefined {
	const normalized_name = name.toLowerCase();

	return attributes.find((attribute) => attribute.name.toLowerCase() === normalized_name);
}

function find_closing_brace(source: string, open: number): number {
	const closing_directive = source
		.slice(open + 1)
		.match(/^\s*\/(?:if|each|await|key|snippet)\s*}/);

	if (closing_directive) {
		return open + 1 + closing_directive[0].lastIndexOf("}");
	}

	let depth = 1;
	let cursor = open + 1;

	while (cursor < source.length) {
		const char = source[cursor];

		if (char === "'" || char === '"') {
			const close = skip_quoted_string(source, cursor, char);

			if (close === -1) {
				return -1;
			}

			cursor = close + 1;
			continue;
		}

		if (char === "`") {
			const close = skip_template_literal(source, cursor);

			if (close === -1) {
				return -1;
			}

			cursor = close + 1;
			continue;
		}

		if (char === "/" && source[cursor + 1] === "/") {
			cursor = skip_line_comment(source, cursor) + 1;
			continue;
		}

		if (char === "/" && source[cursor + 1] === "*") {
			const close = skip_block_comment(source, cursor);

			if (close === -1) {
				return -1;
			}

			cursor = close + 1;
			continue;
		}

		if (char === "/") {
			return find_closing_brace_with_typescript(source, open, cursor);
		}

		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;

			if (depth === 0) {
				return cursor;
			}
		}

		cursor += 1;
	}

	return -1;
}

function find_closing_brace_with_typescript(source: string, open: number, slash: number): number {
	let candidate = source.indexOf("}", slash + 1);
	let candidate_index = 0;
	let next_probe_index = 0;
	let last_candidate = -1;
	let last_probed_candidate = -1;

	while (candidate !== -1) {
		last_candidate = candidate;

		if (candidate_index === next_probe_index) {
			const resolved = resolve_closing_brace_probe(source, open, slash, candidate);

			if (resolved !== -1) {
				return resolved;
			}

			last_probed_candidate = candidate;
			next_probe_index = next_probe_index * 2 + 1;
		}

		candidate_index += 1;
		candidate = source.indexOf("}", candidate + 1);
	}

	if (last_candidate !== last_probed_candidate) {
		return resolve_closing_brace_probe(source, open, slash, last_candidate);
	}

	return -1;
}

function resolve_closing_brace_probe(
	source: string,
	open: number,
	slash: number,
	candidate: number,
): number {
	if (candidate === -1) {
		return -1;
	}

	const probe = parse_closing_brace_probe(source, open, candidate);

	if (probe.is_exact) {
		return candidate;
	}

	if (probe.close < slash || probe.close >= candidate || source[probe.close] !== "}") {
		return -1;
	}

	const exact_probe = parse_closing_brace_probe(source, open, probe.close);

	return exact_probe.is_exact ? probe.close : -1;
}

function parse_closing_brace_probe(
	source: string,
	open: number,
	candidate: number,
): { close: number; is_exact: boolean } {
	const generator_prefix = "function* __SER__(){";
	const boundary_name = "__SER___expression_boundary";
	const boundary_statement = `\nconst ${boundary_name} = 0;`;
	const tail = adapt_svelte_directive_tail(source.slice(open + 1, candidate + 1));
	const source_file = ts.createSourceFile(
		"svelte-expression.ts",
		generator_prefix + tail + boundary_statement,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	) as ParsedSourceFile;
	const declaration = source_file.statements[0];
	const boundary = source_file.statements[1];
	const boundary_declaration =
		boundary && ts.isVariableStatement(boundary)
			? boundary.declarationList.declarations[0]
			: undefined;
	const has_boundary =
		boundary_declaration?.name !== undefined &&
		ts.isIdentifier(boundary_declaration.name) &&
		boundary_declaration.name.text === boundary_name;
	const has_unterminated_regex = source_file.parseDiagnostics?.some(
		(diagnostic) => diagnostic.code === 1161,
	);

	if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) {
		return { close: -1, is_exact: false };
	}

	const close = open + declaration.body.end - generator_prefix.length;

	return {
		close,
		is_exact: close === candidate && has_boundary && !has_unterminated_regex,
	};
}

function adapt_svelte_directive_tail(tail: string): string {
	const const_directive = tail.match(/^(\s*)@(?=const\b)/);

	if (const_directive) {
		const at = const_directive[1].length;

		return tail.slice(0, at) + " " + tail.slice(at + 1);
	}

	const prefix = tail.match(
		/^\s*(?:(?:#(?:if|each|await|key|snippet)|@(?:render|html|debug|attach)|:(?:else\s+if|else|then|catch))\b\s*|\.\.\.\s*)/,
	)?.[0];

	if (!prefix) {
		return tail;
	}

	return blank_source(prefix) + tail.slice(prefix.length);
}

function skip_quoted_string(source: string, start: number, quote: string): number {
	for (let cursor = start + 1; cursor < source.length; cursor += 1) {
		if (source[cursor] === "\\") {
			cursor += 1;
			continue;
		}

		if (source[cursor] === quote) {
			return cursor;
		}
	}

	return -1;
}

function skip_template_literal(source: string, start: number): number {
	let cursor = start + 1;

	while (cursor < source.length) {
		if (source[cursor] === "\\") {
			cursor += 2;
			continue;
		}

		if (source[cursor] === "`") {
			return cursor;
		}

		if (source[cursor] === "$" && source[cursor + 1] === "{") {
			const close = find_closing_brace(source, cursor + 1);

			if (close === -1) {
				return -1;
			}

			cursor = close + 1;
			continue;
		}

		cursor += 1;
	}

	return -1;
}

function skip_line_comment(source: string, start: number): number {
	for (let cursor = start + 2; cursor < source.length; cursor += 1) {
		const char = source[cursor];

		if (char === "\n" || char === "\r" || char === "\u2028" || char === "\u2029") {
			return cursor;
		}
	}

	return source.length;
}

function skip_block_comment(source: string, start: number): number {
	const close = source.indexOf("*/", start + 2);

	return close === -1 ? -1 : close + 1;
}
