import * as fc from "fast-check";

/**
 * Compositional generator for JavaScript expressions with a known free-variable
 * set.
 *
 * `collect_free_identifiers` decides which values a lowered effect re-reads, so
 * an identifier it misses becomes a dependency SER never tracks and a stale
 * render nobody notices. Checking it needs an oracle that is not itself a scope
 * analyser, so every node here carries the exact answer alongside the text: a
 * leaf contributes its own name, and a binding form subtracts the names it
 * binds. The expected set is therefore built by construction rather than
 * recomputed by a second implementation of the thing under test.
 */

export interface ExpressionSpec {
	readonly text: string;
	readonly free: readonly string[];
}

/**
 * Deliberately tiny so the same name lands both inside and outside a binder in
 * the same expression, which is where shadowing bugs live.
 */
const names = ["alpha", "beta", "gamma"] as const;

const property_names = ["length", "value", "name"] as const;

const type_names = ["Alpha", "Beta"] as const;

function union(...specs: readonly ExpressionSpec[]): string[] {
	return [...new Set(specs.flatMap((spec) => spec.free))];
}

function without(spec: ExpressionSpec, bound: readonly string[]): string[] {
	return spec.free.filter((name) => !bound.includes(name));
}

const identifier: fc.Arbitrary<ExpressionSpec> = fc
	.constantFrom(...names)
	.map((name) => ({ text: name, free: [name] }));

const literal: fc.Arbitrary<ExpressionSpec> = fc
	.constantFrom("1", `"text"`, "true", "null", "undefined")
	.map((text) => ({ text, free: [] }));

export const expression_arbitrary: fc.Arbitrary<ExpressionSpec> = fc.letrec<{
	expression: ExpressionSpec;
}>((tie) => ({
	expression: fc.oneof(
		{ maxDepth: 4, withCrossShrink: true },
		identifier,
		literal,

		/**
		 * Property access — the property name is not a reference. The target is
		 * parenthesised because `1.length` is not valid JavaScript.
		 */
		fc
			.tuple(tie("expression"), fc.constantFrom(...property_names))
			.map(([target, property]) => ({
				text: `(${target.text}).${property}`,
				free: target.free,
			})),

		/** Element access — the index expression is a reference. */
		fc.tuple(tie("expression"), tie("expression")).map(([target, index]) => ({
			text: `(${target.text})[${index.text}]`,
			free: union(target, index),
		})),

		fc.tuple(tie("expression"), tie("expression")).map(([callee, argument]) => ({
			text: `(${callee.text})(${argument.text})`,
			free: union(callee, argument),
		})),

		fc
			.tuple(tie("expression"), fc.constantFrom("+", "??", "&&", ">"), tie("expression"))
			.map(([left, operator, right]) => ({
				text: `(${left.text} ${operator} ${right.text})`,
				free: union(left, right),
			})),

		fc
			.tuple(tie("expression"), tie("expression"), tie("expression"))
			.map(([condition, consequent, alternate]) => ({
				text: `(${condition.text} ? ${consequent.text} : ${alternate.text})`,
				free: union(condition, consequent, alternate),
			})),

		/** Object literal with an explicit key — the key is not a reference. */
		fc.tuple(fc.constantFrom(...property_names), tie("expression")).map(([key, value]) => ({
			text: `({ ${key}: ${value.text} })`,
			free: value.free,
		})),

		/** Shorthand property — the key is a reference. */
		fc.constantFrom(...names).map((name) => ({
			text: `({ ${name} })`,
			free: [name],
		})),

		/** Computed key — the key expression is a reference. */
		fc.tuple(tie("expression"), tie("expression")).map(([key, value]) => ({
			text: `({ [${key.text}]: ${value.text} })`,
			free: union(key, value),
		})),

		fc.tuple(tie("expression"), tie("expression")).map(([first, second]) => ({
			text: `[${first.text}, ${second.text}]`,
			free: union(first, second),
		})),

		fc.tuple(tie("expression"), tie("expression")).map(([head, tail]) => ({
			text: `\`prefix \${${head.text}} middle \${${tail.text}}\``,
			free: union(head, tail),
		})),

		/** Type positions are erased and must never contribute a dependency. */
		fc.tuple(tie("expression"), fc.constantFrom(...type_names)).map(([value, type_name]) => ({
			text: `(${value.text} as ${type_name})`,
			free: value.free,
		})),

		/** Arrow parameter shadows the outer binding of the same name. */
		fc.tuple(fc.constantFrom(...names), tie("expression")).map(([parameter, body]) => ({
			text: `((${parameter}) => ${body.text})`,
			free: without(body, [parameter]),
		})),

		/** Destructured parameters bind every extracted name. */
		fc
			.tuple(fc.constantFrom(...names), fc.constantFrom(...names), tie("expression"))
			.map(([first, second, body]) => ({
				text: `(({ ${first}, ${second} }) => ${body.text})`,
				free: without(body, [first, second]),
			})),

		/** Array pattern parameters, including a hole. */
		fc.tuple(fc.constantFrom(...names), tie("expression")).map(([bound, body]) => ({
			text: `(([, ${bound}]) => ${body.text})`,
			free: without(body, [bound]),
		})),

		/** A local declaration binds only after its own initializer. */
		fc
			.tuple(fc.constantFrom(...names), tie("expression"), tie("expression"))
			.map(([name, initializer, body]) => ({
				text: `(() => { const ${name} = ${initializer.text}; return ${body.text}; })()`,
				free: [...new Set([...initializer.free, ...without(body, [name])])],
			})),

		/** A generator boundary still binds its parameters. */
		fc.tuple(fc.constantFrom(...names), tie("expression")).map(([parameter, body]) => ({
			text: `(function* (${parameter}) { return ${body.text}; })`,
			free: without(body, [parameter]),
		})),

		/**
		 * A default value is evaluated in parameter scope, so it can reference
		 * outer bindings but not the parameter it is defaulting — naming that
		 * parameter there is a temporal dead zone error, not an outer reference.
		 */
		fc
			.tuple(fc.constantFrom(...names), tie("expression"), tie("expression"))
			.map(([parameter, fallback, body]) => ({
				text: `((${parameter} = ${fallback.text}) => ${body.text})`,
				free: [
					...new Set([...without(fallback, [parameter]), ...without(body, [parameter])]),
				],
			})),

		/** Rest parameters bind a name too. */
		fc.tuple(fc.constantFrom(...names), tie("expression")).map(([parameter, body]) => ({
			text: `((...${parameter}) => ${body.text})`,
			free: without(body, [parameter]),
		})),

		/** An object method binds its parameters exactly like a function does. */
		fc
			.tuple(fc.constantFrom(...property_names), fc.constantFrom(...names), tie("expression"))
			.map(([method, parameter, body]) => ({
				text: `({ ${method}(${parameter}) { return ${body.text}; } })`,
				free: without(body, [parameter]),
			})),

		/** An accessor body is a function scope with no parameters. */
		fc.tuple(fc.constantFrom(...property_names), tie("expression")).map(([accessor, body]) => ({
			text: `({ get ${accessor}() { return ${body.text}; } })`,
			free: body.free,
		})),

		/** A class method is another function scope the walker must respect. */
		fc
			.tuple(fc.constantFrom(...property_names), fc.constantFrom(...names), tie("expression"))
			.map(([method, parameter, body]) => ({
				text: `(class { ${method}(${parameter}) { return ${body.text}; } })`,
				free: without(body, [parameter]),
			})),

		/** A catch clause binds its parameter for the handler block only. */
		fc
			.tuple(fc.constantFrom(...names), tie("expression"), tie("expression"))
			.map(([bound, attempted, handled]) => ({
				text: `(() => { try { return ${attempted.text}; } catch (${bound}) { return ${handled.text}; } })()`,
				free: [...new Set([...attempted.free, ...without(handled, [bound])])],
			})),

		/** A loop binding is scoped to the loop. */
		fc
			.tuple(fc.constantFrom(...names), tie("expression"), tie("expression"))
			.map(([bound, iterable, body]) => ({
				text: `(() => { for (const ${bound} of ${iterable.text}) { return ${body.text}; } })()`,
				free: [...new Set([...iterable.free, ...without(body, [bound])])],
			})),

		/** Nested binders of the same name must not leak out of the inner one. */
		fc.tuple(fc.constantFrom(...names), tie("expression")).map(([parameter, body]) => ({
			text: `((${parameter}) => ((${parameter}) => ${body.text}))`,
			free: without(body, [parameter]),
		})),
	),
})).expression;
