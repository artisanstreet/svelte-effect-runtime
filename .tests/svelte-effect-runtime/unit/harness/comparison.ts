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
		const shared_length = Math.min(oracle.length, subject.length);
		const length_difference: ReadonlyArray<Difference> =
			oracle.length === subject.length
				? []
				: [{ path: `${path}.length`, oracle: oracle.length, subject: subject.length }];
		const item_differences = Array.from({ length: shared_length }, (_, index) =>
			find_differences(oracle[index], subject[index], `${path}[${index}]`),
		).flat();

		return [...length_difference, ...item_differences];
	}

	if (is_plain_record(oracle) && is_plain_record(subject)) {
		const keys = [...new Set([...Object.keys(oracle), ...Object.keys(subject)])].sort();

		return keys.flatMap((key) => {
			const oracle_has_key = Object.hasOwn(oracle, key);
			const subject_has_key = Object.hasOwn(subject, key);

			if (oracle_has_key !== subject_has_key) {
				return [{ path: `${path}.${key}`, oracle: oracle[key], subject: subject[key] }];
			}

			return find_differences(oracle[key], subject[key], `${path}.${key}`);
		});
	}

	return [{ path, oracle, subject }];
}

function is_plain_record(value: unknown): value is Readonly<Record<string, unknown>> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const prototype = Object.getPrototypeOf(value) as unknown;

	return prototype === Object.prototype || prototype === null;
}
