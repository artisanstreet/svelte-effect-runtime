import { Schema } from "effect";

import type * as vscode from "vscode";

/**
 * Extension context capabilities used to read and update global state.
 *
 * @example
 * ```ts
 * const context: GlobalStateContext = extension_context;
 * ```
 *
 * @since 4.0.1
 */
export interface GlobalStateContext {
	/** Persistent extension state shared across workspaces. */
	readonly globalState: Pick<vscode.Memento, "get" | "update">;
}

/**
 * Extension context capabilities used by legacy configuration migration.
 *
 * @example
 * ```ts
 * const context: LegacyMigrationContext = extension_context;
 * ```
 *
 * @since 4.0.1
 */
export interface LegacyMigrationContext extends GlobalStateContext {
	/** Resolves a path relative to the installed extension directory. */
	readonly asAbsolutePath: vscode.ExtensionContext["asAbsolutePath"];
}

/**
 * Extension context capabilities used to locate the shared install cache.
 *
 * @example
 * ```ts
 * const context: GlobalStorageContext = extension_context;
 * ```
 *
 * @since 4.0.1
 */
export interface GlobalStorageContext {
	/** Filesystem location reserved for persistent extension data. */
	readonly globalStorageUri: Pick<vscode.Uri, "fsPath">;
}

/**
 * Output capability used by server-path resolution and installation.
 *
 * @example
 * ```ts
 * const output: InstallOutput = output_channel;
 * ```
 *
 * @since 4.0.1
 */
export interface InstallOutput {
	/** Appends one diagnostic line to the extension output. */
	readonly appendLine: (message: string) => void;
}

/**
 * Extension context capability used to retain registered disposables.
 *
 * @example
 * ```ts
 * const context: SubscriptionContext = extension_context;
 * ```
 *
 * @since 4.0.1
 */
export interface SubscriptionContext {
	/** Activation-scoped disposables released by VS Code. */
	readonly subscriptions: {
		readonly push: (...disposables: vscode.Disposable[]) => unknown;
	};
}

/**
 * Schema for the supported VS Code language-client strategies.
 *
 * @example
 * ```ts
 * const mode = Schema.decodeUnknownSync(ClientModeSchema)("auto");
 * ```
 *
 * @since 4.0.1
 */
export const ClientModeSchema = Schema.Literals(["auto", "direct", "svelteExtension"]);

/**
 * Strategy used by the VS Code extension to connect to the language server.
 *
 * @example
 * ```ts
 * const mode: ClientMode = "auto";
 * ```
 *
 * @since 2.0.0
 */
export type ClientMode = typeof ClientModeSchema.Type;
