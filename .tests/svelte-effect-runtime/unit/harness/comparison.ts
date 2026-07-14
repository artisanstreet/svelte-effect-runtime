import type { Comparison, Difference, Observation } from "./model.ts";

export function compare_observations(oracle: Observation, subject: Observation): Comparison {
	if (oracle.scenario_id !== subject.scenario_id) {
		throw new Error(
			`Cannot compare ${oracle.scenario_id} with ${subject.scenario_id}; scenario ids must match.`,
		);
	}

	const differences = find_differences(oracle.value, subject.value);

	return {
		scenario_id: oracle.scenario_id,
		oracle: oracle.target,
		subject: subject.target,
		matches: differences.length === 0,
		differences,
	};
}

export function find_differences(
	oracle: unknown,
	subject: unknown,
	path = "$",
): ReadonlyArray<Difference> {
	if (Object.is(oracle, subject)) {
		return [];
	}

	if (Array.isArray(oracle) && Array.isArray(subject)) {
		const length = Math.max(oracle.length, subject.length);

		return Array.from({ length }, (_, index) =>
			find_differences(oracle[index], subject[index], `${path}[${index}]`),
		).flat();
	}

	if (is_record(oracle) && is_record(subject)) {
		const keys = [...new Set([...Object.keys(oracle), ...Object.keys(subject)])].sort();

		return keys.flatMap((key) => find_differences(oracle[key], subject[key], `${path}.${key}`));
	}

	return [{ path, oracle, subject }];
}

function is_record(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
