import {
	SvelteExtensionControl,
	SvelteExtensionControlLive,
} from "../../../modules/svelte-effect-runtime-vsix/src/extension/svelte-extension-control.ts";
import { get_server_dispatcher } from "../../../modules/svelte-effect-runtime/src/server/runtime.ts";
import { assert_equals } from "../../svelte-effect-runtime/unit/helpers/assert.ts";
import { beforeEach, test, vi } from "vitest";
import { Effect } from "effect";

const vscode_commands = vi.hoisted(() => ({
	execute_command: vi.fn(),
	get_commands: vi.fn(),
}));

vi.mock("vscode", () => ({
	commands: {
		executeCommand: vscode_commands.execute_command,
		getCommands: vscode_commands.get_commands,
	},
}));

beforeEach(() => {
	vi.resetAllMocks();
});

test("VS Code Svelte restart falls back when command discovery fails", async () => {
	vscode_commands.get_commands.mockRejectedValueOnce(new Error("discovery failed"));

	const restarted = await get_server_dispatcher().run(Restart);

	assert_equals(restarted, false);
});

test("VS Code Svelte restart falls back when command execution fails", async () => {
	vscode_commands.get_commands.mockResolvedValueOnce(["svelte.restartLanguageServer"]);
	vscode_commands.execute_command.mockRejectedValueOnce(new Error("execution failed"));

	const restarted = await get_server_dispatcher().run(Restart);

	assert_equals(restarted, false);
});

test("VS Code Svelte restart reports unavailable when the command is absent", async () => {
	vscode_commands.get_commands.mockResolvedValueOnce([]);

	const restarted = await get_server_dispatcher().run(Restart);

	assert_equals(restarted, false);
});

test("VS Code Svelte restart reports success after executing the command", async () => {
	vscode_commands.get_commands.mockResolvedValueOnce(["svelte.restartLanguageServer"]);
	vscode_commands.execute_command.mockResolvedValueOnce(undefined);

	const restarted = await get_server_dispatcher().run(Restart);

	assert_equals(restarted, true);
});

const Restart = Effect.gen(function* () {
	const svelte_extension = yield* SvelteExtensionControl;

	return yield* svelte_extension.restart;
}).pipe(Effect.provide(SvelteExtensionControlLive));
