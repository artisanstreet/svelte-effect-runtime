import {
	assert_safe_language_server_path,
	can_configure_svelte_language_server_path,
	get_workspace_configured_server_path,
	normalize_configured_server_path,
} from "./server-path-policy.ts";
import { legacy_state_managed_path, legacy_state_previous_path } from "./constants.ts";
import { ExtensionState } from "./extension-services.ts";
import { ExtensionConfiguration } from "./settings.ts";
import { Effect, FileSystem, Option } from "effect";
import { paths_equal } from "./paths.ts";

export const MigrateLegacySvelteConfiguration = (legacy_server_path: string) =>
	Effect.gen(function* () {
		const state = yield* ExtensionState;
		const current_path = yield* GetGlobalSvelteLanguageServerPath;
		const managed_path = yield* state.read_path(legacy_state_managed_path);

		if (paths_equal(current_path, legacy_server_path) && Option.isNone(managed_path)) {
			yield* state.write_path(legacy_state_managed_path, legacy_server_path);
		}
	});

export const ConfigureSvelteExtensionLanguageServer = (
	server_path: string,
	options: { force: boolean },
) =>
	Effect.gen(function* () {
		const configuration = yield* ExtensionConfiguration;
		const state = yield* ExtensionState;
		const file_system = yield* FileSystem.FileSystem;
		const scoped_path = yield* configuration.inspect_svelte_server_path;
		const workspace_path = get_workspace_configured_server_path(scoped_path);
		const current_path = normalize_configured_server_path(scoped_path.global_path);
		const current_path_exists = current_path
			? yield* file_system.exists(current_path).pipe(Effect.orElseSucceed(() => false))
			: false;
		const managed_path = yield* state.read_path(legacy_state_managed_path);
		const previous_path = yield* state.read_path(legacy_state_previous_path);
		const managed_path_value = Option.getOrUndefined(managed_path);
		const can_configure = can_configure_svelte_language_server_path({
			current_path,
			current_path_exists,
			force: options.force,
			managed_path: managed_path_value,
			server_path,
		});

		yield* Effect.try(() => assert_safe_language_server_path(server_path));

		if (workspace_path) {
			return false;
		}

		if (!options.force && !can_configure) {
			return false;
		}

		const should_record_previous_path =
			current_path &&
			current_path_exists &&
			!paths_equal(current_path, server_path) &&
			!paths_equal(current_path, managed_path_value);
		const Configure = Effect.gen(function* () {
			if (should_record_previous_path) {
				yield* state.write_path(legacy_state_previous_path, current_path);
			}

			yield* configuration.write_svelte_server_path(server_path);
			yield* state.write_path(legacy_state_managed_path, server_path);
		});
		const RestoreSnapshot = Effect.gen(function* () {
			yield* configuration.write_svelte_server_path(current_path).pipe(Effect.ignore);
			yield* state
				.write_path(legacy_state_managed_path, Option.getOrUndefined(managed_path))
				.pipe(Effect.ignore);
			yield* state
				.write_path(legacy_state_previous_path, Option.getOrUndefined(previous_path))
				.pipe(Effect.ignore);
		});

		yield* Configure.pipe(Effect.onError(() => RestoreSnapshot));

		return true;
	});

export const RestoreSvelteExtensionConfiguration = Effect.gen(function* () {
	const configuration = yield* ExtensionConfiguration;
	const state = yield* ExtensionState;
	const current_path = yield* GetGlobalSvelteLanguageServerPath;
	const managed_path = yield* state.read_path(legacy_state_managed_path);
	const previous_path = yield* state.read_path(legacy_state_previous_path);

	if (paths_equal(current_path, Option.getOrUndefined(managed_path))) {
		yield* configuration.write_svelte_server_path(Option.getOrUndefined(previous_path));
	}

	yield* state.write_path(legacy_state_managed_path, undefined);
	yield* state.write_path(legacy_state_previous_path, undefined);
});

const GetGlobalSvelteLanguageServerPath = Effect.gen(function* () {
	const configuration = yield* ExtensionConfiguration;
	const scoped_path = yield* configuration.inspect_svelte_server_path;

	return normalize_configured_server_path(scoped_path.global_path);
});
