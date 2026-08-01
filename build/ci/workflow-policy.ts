import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path } from "effect";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

export type WorkflowPolicyInput = {
	readonly workflow: unknown;
	readonly setup_action: unknown;
	readonly workflow_files: ReadonlyArray<string>;
};

export const required_check_names = Object.freeze([
	"Capability / Compiler",
	"Capability / Runtime and lifecycle",
	"Capability / Signals and reactivity",
	"Capability / Remote transport",
	"Capability / Public API",
	"Capability / Type contracts",
	"Capability / Package and tooling",
	"Staging verified",
	"Candidate verified",
]);

const artifact_job_ids = [
	"artifact_runtime",
	"artifact_grammars",
	"artifact_language_server",
	"artifact_vsix",
] as const;
const candidate_job_ids = [
	...artifact_job_ids,
	"candidate_assemble",
	"candidate_consumer_smoke",
	"candidate_browser_smoke",
	"candidate_verified",
	"dry_run",
	"release_gate",
	"github_prepare",
	"npm_publish",
	"github_assets",
	"openvsx_publish",
	"github_finalize",
	"promotion_evidence",
] as const;
const expected_trigger_names = ["pull_request", "push", "workflow_dispatch"];
const fast_runner_job_id = "capability_transport";
const fast_runner = "blacksmith-4vcpu-ubuntu-2404";
const standard_runner = "ubuntu-latest";
const candidate_job_guard =
	"github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/candidate'";
const forbidden_surface =
	/(?:marketplace\.visualstudio|visual studio marketplace|azure\/login|AZURE_(?:CLIENT|TENANT)|\btfx\b|\bjsr\b)/i;

export function find_workflow_policy_violations(input: WorkflowPolicyInput): ReadonlyArray<string> {
	const violations: Array<string> = [];
	const workflow = require_record(input.workflow, "workflow", violations);
	const setup_action = require_record(input.setup_action, "setup action", violations);
	const triggers = require_record(workflow.on, "workflow.on", violations);
	const jobs = require_record(workflow.jobs, "workflow.jobs", violations);
	const trigger_names = Object.keys(triggers).sort();
	const job_names = Object.values(jobs)
		.map((job) => optional_record(job)?.name)
		.filter((name): name is string => typeof name === "string");

	require_equal_list(
		trigger_names,
		[...expected_trigger_names].sort(),
		"workflow triggers",
		violations,
	);
	require_branch_trigger(triggers, "pull_request", violations);
	require_branch_trigger(triggers, "push", violations);

	for (const required_name of required_check_names) {
		if (!job_names.includes(required_name)) {
			violations.push(`Required capability check is missing: ${required_name}.`);
		}
	}

	if (Object.keys(optional_record(workflow.permissions) ?? {}).length !== 0) {
		violations.push("Workflow-level permissions must be empty.");
	}

	const root_concurrency = require_record(
		workflow.concurrency,
		"workflow.concurrency",
		violations,
	);

	if (!String(root_concurrency.group).includes("ser-ci-")) {
		violations.push("Ordinary CI requires a ref-scoped cancellation group.");
	}

	if (!String(root_concurrency.group).includes("ser-release")) {
		violations.push("Publishing runs require one workflow-scoped release mutex.");
	}

	if (!String(root_concurrency.queue).includes("max")) {
		violations.push("Publishing runs must retain every queued release request.");
	}

	if (!String(root_concurrency["cancel-in-progress"]).includes("dry-run")) {
		violations.push("Publishing runs must be excluded from workflow cancellation.");
	}

	for (const job_id of candidate_job_ids) {
		const job = require_job(jobs, job_id, violations);
		const job_condition = String(job.if).replace(/^always\(\)\s*&&\s*/, "");

		if (
			!job_condition.startsWith(candidate_job_guard) ||
			has_top_level_disjunction(job_condition)
		) {
			violations.push(`${job_id} must be gated on a manual candidate dispatch.`);
		}
	}

	for (const job_id of artifact_job_ids) {
		const job = require_job(jobs, job_id, violations);

		if (!String(job.if).includes("inputs.mode != 'resume'")) {
			violations.push(`${job_id} must be skipped during resume.`);
		}
	}

	const language_server = require_job(jobs, "artifact_language_server", violations);
	const assembly = require_job(jobs, "candidate_assemble", violations);
	const dry_run = require_job(jobs, "dry_run", violations);
	const release_gate = require_job(jobs, "release_gate", violations);
	const github_prepare = require_job(jobs, "github_prepare", violations);
	const npm_publish = require_job(jobs, "npm_publish", violations);
	const github_assets = require_job(jobs, "github_assets", violations);
	const openvsx_publish = require_job(jobs, "openvsx_publish", violations);
	const github_finalize = require_job(jobs, "github_finalize", violations);
	const promotion_evidence = require_job(jobs, "promotion_evidence", violations);

	if (npm_publish["runs-on"] !== "ubuntu-latest") {
		violations.push("npm trusted publishing must run on a GitHub-hosted runner.");
	}

	require_need(language_server, "artifact_runtime", "language-server build", violations);

	for (const dependency of ["plan", "staging_verified", ...artifact_job_ids]) {
		require_need(assembly, dependency, "candidate assembly", violations);
	}

	if (!String(assembly.if).includes("always()") || !String(assembly.if).includes("skipped")) {
		violations.push("Candidate assembly must explicitly handle skipped resume build jobs.");
	}

	if (release_gate.environment !== "release-approval") {
		violations.push("Publication must cross the protected release approval boundary once.");
	}

	const release_gate_condition = String(release_gate.if);

	if (
		!release_gate_condition.includes("always()") ||
		!release_gate_condition.includes("!cancelled()") ||
		!release_gate_condition.includes("needs.plan.result == 'success'") ||
		!release_gate_condition.includes("needs.candidate_verified.result == 'success'")
	) {
		violations.push(
			"Release approval must survive skipped resume ancestors and require successful candidate verification.",
		);
	}

	require_need(github_prepare, "release_gate", "GitHub preparation", violations);
	require_need(npm_publish, "github_prepare", "npm publication", violations);
	require_need(github_assets, "github_prepare", "GitHub asset publication", violations);
	require_need(openvsx_publish, "npm_publish", "OpenVSX publication", violations);

	for (const [job_id, job] of [
		["github_prepare", github_prepare],
		["npm_publish", npm_publish],
		["github_assets", github_assets],
		["openvsx_publish", openvsx_publish],
		["github_finalize", github_finalize],
	] as const) {
		if (
			!String(job.if).includes("always()") ||
			!String(job.if).includes("result == 'success'")
		) {
			violations.push(
				`${job_id} must survive skipped resume ancestors and require successful direct dependencies.`,
			);
		}
	}

	for (const dependency of ["npm_publish", "github_assets", "openvsx_publish"]) {
		require_need(github_finalize, dependency, "GitHub finalization", violations);
	}

	for (const dependency of [
		"github_prepare",
		"npm_publish",
		"github_assets",
		"openvsx_publish",
		"github_finalize",
	]) {
		require_need(promotion_evidence, dependency, "promotion evidence", violations);
	}

	const openvsx_environment = optional_record(openvsx_publish.environment);

	if (openvsx_environment?.name !== "release" || openvsx_environment.deployment !== false) {
		violations.push("OpenVSX alone may read the release-scoped publication token.");
	}

	if (dry_run.environment !== undefined || JSON.stringify(dry_run).includes("secrets.")) {
		violations.push("Dry-run must not use an environment or repository secrets.");
	}

	if (!JSON.stringify(dry_run).includes("--dry-run true")) {
		violations.push("Dry-run must invoke the zero-write promotion mode.");
	}

	const dry_run_steps = Array.isArray(dry_run.steps) ? dry_run.steps : [];
	const dry_run_checkout = dry_run_steps
		.map(optional_record)
		.find((step) => step?.name === "Checkout selected commit");
	const dry_run_checkout_options = optional_record(dry_run_checkout?.with);

	if (dry_run_checkout_options?.["fetch-depth"] !== 0) {
		violations.push("Dry-run must fetch candidate history before promotion checks.");
	}

	validate_job_runners(jobs, violations);
	validate_permissions(jobs, violations);
	validate_action_pins([workflow, setup_action], violations);
	validate_artifact_uploads(jobs, violations);
	validate_shell_inputs(jobs, violations);

	if (forbidden_surface.test(JSON.stringify(input))) {
		violations.push("Workflow configuration contains an unsupported publication surface.");
	}

	require_equal_list(input.workflow_files, ["ci.yml"], "workflow files", violations);

	return Object.freeze(violations);
}

function has_top_level_disjunction(condition: string): boolean {
	let depth = 0;
	let quote: "'" | '"' | undefined;

	for (let index = 0; index < condition.length; index += 1) {
		const character = condition[index];

		if (quote) {
			if (character === quote && condition[index - 1] !== "\\") {
				quote = undefined;
			}

			continue;
		}

		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}

		if (character === "(") {
			depth += 1;
			continue;
		}

		if (character === ")") {
			depth -= 1;
			continue;
		}

		if (depth === 0 && character === "|" && condition[index + 1] === "|") {
			return true;
		}
	}

	return false;
}

function validate_job_runners(
	jobs: Readonly<Record<string, unknown>>,
	violations: Array<string>,
): void {
	for (const [job_id, value] of Object.entries(jobs)) {
		const job = require_record(value, `job ${job_id}`, violations);
		const expected_runner =
			job_id === fast_runner_job_id ? fast_runner : standard_runner;

		if (job["runs-on"] === expected_runner) {
			continue;
		}

		violations.push(`${job_id} must run on ${expected_runner}.`);
	}
}

function validate_shell_inputs(
	jobs: Readonly<Record<string, unknown>>,
	violations: Array<string>,
): void {
	for (const [job_id, value] of Object.entries(jobs)) {
		const job = optional_record(value);
		const steps = Array.isArray(job?.steps) ? job.steps : [];

		for (const step_value of steps) {
			const step = optional_record(step_value);
			const run = typeof step?.run === "string" ? step.run : "";

			if (run.includes("${{ inputs.")) {
				violations.push(
					`${job_id} interpolates manual input directly into a shell script.`,
				);
			}
		}
	}
}

function validate_permissions(
	jobs: Readonly<Record<string, unknown>>,
	violations: Array<string>,
): void {
	for (const [job_id, value] of Object.entries(jobs)) {
		const job = require_record(value, `job ${job_id}`, violations);
		const permissions = optional_record(job.permissions) ?? {};
		const serialized = JSON.stringify(job);
		const can_write = Object.values(permissions).includes("write");
		const has_identity = permissions["id-token"] !== undefined;
		const has_secrets = serialized.includes("secrets.");
		const has_environment = job.environment !== undefined;

		if (["github_prepare", "github_assets", "github_finalize"].includes(job_id)) {
			if (
				!permissions_match(permissions, { actions: "read", contents: "write" }) ||
				has_identity ||
				has_secrets ||
				has_environment
			) {
				violations.push(`${job_id} must own only GitHub release write authority.`);
			}

			continue;
		}

		if (job_id === "npm_publish") {
			if (
				!permissions_match(permissions, {
					actions: "read",
					contents: "read",
					"id-token": "write",
				}) ||
				has_secrets ||
				has_environment
			) {
				violations.push("npm publication must use only read access and OIDC authority.");
			}

			continue;
		}

		if (job_id === "openvsx_publish") {
			if (
				!permissions_match(permissions, { actions: "read", contents: "read" }) ||
				has_identity ||
				!serialized.includes("secrets.OPEN_VSX_TOKEN") ||
				serialized.match(/secrets\./g)?.length !== 1 ||
				!has_environment
			) {
				violations.push("OpenVSX publication must own only its release-scoped token.");
			}

			continue;
		}

		if (job_id === "release_gate") {
			if (can_write || has_identity || has_secrets || !has_environment) {
				violations.push(
					"Release approval must gate publication without mutation authority.",
				);
			}

			continue;
		}

		if (can_write || has_identity || has_secrets || has_environment) {
			violations.push(`${job_id} exceeds read-only verification authority.`);
		}
	}
}

function permissions_match(
	actual: Readonly<Record<string, unknown>>,
	expected: Readonly<Record<string, string>>,
): boolean {
	const actual_keys = Object.keys(actual);
	const expected_keys = Object.keys(expected);

	return (
		actual_keys.length === expected_keys.length &&
		expected_keys.every((key) => actual[key] === expected[key])
	);
}

function validate_action_pins(values: ReadonlyArray<unknown>, violations: Array<string>): void {
	const uses_values = values.flatMap(find_uses_values);
	const mutable_action = uses_values.find(
		(value) => !value.startsWith("./") && !/^[^@]+@[a-f0-9]{40}$/.test(value),
	);

	if (mutable_action) {
		violations.push(`External action is not pinned to a full commit: ${mutable_action}.`);
	}
}

function validate_artifact_uploads(
	jobs: Readonly<Record<string, unknown>>,
	violations: Array<string>,
): void {
	for (const value of Object.values(jobs)) {
		const job = optional_record(value);
		const steps = Array.isArray(job?.steps) ? job.steps : [];

		for (const step_value of steps) {
			const step = optional_record(step_value);

			if (!String(step?.uses ?? "").startsWith("actions/upload-artifact@")) {
				continue;
			}

			const with_options = optional_record(step?.with) ?? {};
			const path = String(with_options.path ?? "");

			if (path.startsWith(".")) {
				violations.push(`Artifact upload path must be non-hidden: ${path}.`);
			}

			if (with_options.overwrite !== undefined) {
				violations.push("Artifact uploads must never replace an existing artifact ID.");
			}
		}
	}
}

function find_uses_values(value: unknown): ReadonlyArray<string> {
	if (Array.isArray(value)) {
		return value.flatMap(find_uses_values);
	}

	const record = optional_record(value);

	if (!record) {
		return [];
	}

	return [
		...(typeof record.uses === "string" ? [record.uses] : []),
		...Object.values(record).flatMap(find_uses_values),
	];
}

function require_branch_trigger(
	triggers: Readonly<Record<string, unknown>>,
	name: "pull_request" | "push",
	violations: Array<string>,
): void {
	const trigger = require_record(triggers[name], `workflow.on.${name}`, violations);
	const branches = Array.isArray(trigger.branches) ? trigger.branches : [];

	require_equal_list(branches, ["master"], `${name} branches`, violations);

	if (trigger.tags !== undefined) {
		violations.push(`${name} must not include tag triggers.`);
	}
}

function require_need(
	job: Readonly<Record<string, unknown>>,
	dependency: string,
	label: string,
	violations: Array<string>,
): void {
	const needs = Array.isArray(job.needs) ? job.needs : [job.needs].filter(Boolean);

	if (!needs.includes(dependency)) {
		violations.push(`${label} must depend on ${dependency}.`);
	}
}

function require_job(
	jobs: Readonly<Record<string, unknown>>,
	id: string,
	violations: Array<string>,
): Readonly<Record<string, unknown>> {
	return require_record(jobs[id], `job ${id}`, violations);
}

function require_record(
	value: unknown,
	label: string,
	violations: Array<string>,
): Readonly<Record<string, unknown>> {
	const record = optional_record(value);

	if (!record) {
		violations.push(`${label} must be an object.`);

		return {};
	}

	return record;
}

function optional_record(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}

function require_equal_list(
	actual: ReadonlyArray<unknown>,
	expected: ReadonlyArray<unknown>,
	label: string,
	violations: Array<string>,
): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		violations.push(
			`${label} must be ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`,
		);
	}
}

const Main = Effect.gen(function* () {
	const file_system = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const workflow_path = process.argv[2] ?? ".github/workflows/ci.yml";
	const workflow_dir = path.dirname(workflow_path);
	const [workflow_source, setup_source, workflow_files] = yield* Effect.all(
		[
			file_system.readFileString(workflow_path),
			file_system.readFileString(".github/actions/setup/action.yml"),
			file_system.readDirectory(workflow_dir),
		] as const,
		{ concurrency: "unbounded" },
	);
	const violations = find_workflow_policy_violations({
		workflow: parse(workflow_source),
		setup_action: parse(setup_source),
		workflow_files: workflow_files.sort(),
	});

	if (violations.length > 0) {
		return yield* Effect.fail(new Error(violations.join("\n")));
	}

	yield* Console.log("SER workflow policy verified.");
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	NodeRuntime.runMain(Main.pipe(Effect.provide(NodeServices.layer)));
}
