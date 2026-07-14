import { Schema } from "effect";

export type Provider = "npm" | "openvsx" | "github-release";

export type Absent = {
	readonly _tag: "Absent";
	readonly url: string;
};

export type Matching = {
	readonly _tag: "Matching";
	readonly url: string;
	readonly digest: string;
};

export type Mismatched = {
	readonly _tag: "Mismatched";
	readonly url: string;
	readonly expected_digest: string;
	readonly actual_digest: string;
};

export type AuthenticationFailure = {
	readonly _tag: "AuthenticationFailure";
	readonly url: string;
	readonly status: number;
};

export type ProviderUnavailable = {
	readonly _tag: "ProviderUnavailable";
	readonly url: string;
	readonly status: number | undefined;
	readonly reason: string;
};

export type ProviderState =
	| Absent
	| Matching
	| Mismatched
	| AuthenticationFailure
	| ProviderUnavailable;

export type ProbeDecision =
	| {
			readonly _tag: "Complete";
			readonly state: Matching;
	  }
	| {
			readonly _tag: "Failed";
			readonly state: Mismatched | AuthenticationFailure;
	  }
	| {
			readonly _tag: "Retry";
			readonly next_attempt: number;
			readonly reason: "artifact-not-visible" | "provider-unavailable";
	  }
	| {
			readonly _tag: "Exhausted";
			readonly attempts: number;
			readonly last_state: Absent | ProviderUnavailable;
			readonly diagnostic: string;
	  };

export type ProbePosition = {
	attempt: number;
	max_attempts: number;
};

const ProviderSchema = Schema.Literals(["npm", "openvsx", "github-release"] as const);
const HttpResponseSchema = Schema.Struct({
	_tag: Schema.Literals(["HttpResponse"] as const),
	provider: ProviderSchema,
	status: Schema.Number,
	url: Schema.String,
	expected_digest: Schema.String,
	observed_digest: Schema.optional(Schema.String),
});
const TimeoutSchema = Schema.Struct({
	_tag: Schema.Literals(["Timeout"] as const),
	provider: ProviderSchema,
	url: Schema.String,
	expected_digest: Schema.String,
	reason: Schema.String,
});

export const ProviderObservationSchema = Schema.Union([HttpResponseSchema, TimeoutSchema]);

export function classify_provider_state(input: unknown): ProviderState {
	const observation = Schema.decodeUnknownSync(ProviderObservationSchema)(input);

	if (observation._tag === "Timeout") {
		return {
			_tag: "ProviderUnavailable",
			url: observation.url,
			status: undefined,
			reason: observation.reason,
		};
	}

	const { provider, status, url, expected_digest, observed_digest } = observation;

	if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
		throw new Error(`Invalid provider HTTP status ${status}.`);
	}

	if (status === 404) {
		return { _tag: "Absent", url };
	}

	if (status === 401 || status === 403) {
		return { _tag: "AuthenticationFailure", url, status };
	}

	if (status !== 200) {
		return {
			_tag: "ProviderUnavailable",
			url,
			status,
			reason: `Provider returned HTTP ${status}.`,
		};
	}

	const expected = normalize_expected_digest(provider, expected_digest);

	if (observed_digest === undefined) {
		return {
			_tag: "ProviderUnavailable",
			url,
			status,
			reason: "Provider response did not include artifact integrity.",
		};
	}

	const actual = normalize_observed_digest(provider, observed_digest);

	if (actual === expected) {
		return { _tag: "Matching", url, digest: expected };
	}

	return {
		_tag: "Mismatched",
		url,
		expected_digest: expected,
		actual_digest: actual ?? observed_digest.trim(),
	};
}

export function decide_probe(state: ProviderState, position: ProbePosition): ProbeDecision {
	const { attempt, max_attempts } = position;

	if (!Number.isSafeInteger(attempt) || attempt < 1) {
		throw new Error(`Probe attempt must be a positive integer, received ${attempt}.`);
	}

	if (!Number.isSafeInteger(max_attempts) || max_attempts < 1) {
		throw new Error(`Probe max_attempts must be a positive integer, received ${max_attempts}.`);
	}

	if (attempt > max_attempts) {
		throw new Error(`Probe attempt ${attempt} exceeds max_attempts ${max_attempts}.`);
	}

	if (state._tag === "Matching") {
		return { _tag: "Complete", state };
	}

	if (state._tag === "AuthenticationFailure" || state._tag === "Mismatched") {
		return { _tag: "Failed", state };
	}

	if (attempt < max_attempts) {
		return {
			_tag: "Retry",
			next_attempt: attempt + 1,
			reason: state._tag === "Absent" ? "artifact-not-visible" : "provider-unavailable",
		};
	}

	const diagnostic =
		state._tag === "Absent"
			? `Artifact remained absent after ${attempt} attempts.`
			: `Provider remained unavailable after ${attempt} attempts: ${state.reason}`;

	return {
		_tag: "Exhausted",
		attempts: attempt,
		last_state: state,
		diagnostic,
	};
}

function normalize_expected_digest(provider: Provider, digest: string): string {
	const normalized = normalize_observed_digest(provider, digest);

	if (!normalized) {
		throw new Error(`Invalid expected ${provider} digest: ${digest}.`);
	}

	return normalized;
}

function normalize_observed_digest(provider: Provider, digest: string): string | undefined {
	const trimmed = digest.trim();

	if (provider === "npm") {
		return /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(trimmed) ? trimmed : undefined;
	}

	const match = /^(?:sha256:)?([a-f0-9]{64})(?:\s+.*)?$/i.exec(trimmed);

	return match ? `sha256:${match[1].toLowerCase()}` : undefined;
}
