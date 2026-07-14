import type { Observation } from "./model.ts";

export type NormalizationRule = {
	readonly name: string;
	readonly rationale: string;
	readonly apply: (value: string) => string;
};

export const default_normalization_rules: ReadonlyArray<NormalizationRule> = [
	{
		name: "line-endings",
		rationale: "Line endings are platform metadata and do not change SvelteKit behavior.",
		apply: (value) => value.replaceAll("\r\n", "\n"),
	},
	{
		name: "loopback-ports",
		rationale:
			"Playwright assigns isolated local server ports that are unrelated to compatibility.",
		apply: (value) =>
			value.replaceAll(/(https?:\/\/(?:127\.0\.0\.1|localhost)):\d+/g, "$1:<port>"),
	},
];

export function normalize_observation<Value>(
	observation: Observation<Value>,
	rules = default_normalization_rules,
): Observation<Value> {
	return {
		...observation,
		value: normalize_value(observation.value, rules),
	};
}

export function normalize_value<Value>(value: Value, rules = default_normalization_rules): Value {
	if (typeof value === "string") {
		return rules.reduce((normalized, rule) => rule.apply(normalized), value) as Value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => normalize_value(item, rules)) as Value;
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value).map(([key, item]) => [
			key,
			normalize_value(item, rules),
		]);

		return Object.fromEntries(entries) as Value;
	}

	return value;
}
