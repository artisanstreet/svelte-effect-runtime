import { Schema } from "effect";

import type * as vscode from "vscode";

export interface GlobalStateContext {
	readonly globalState: Pick<vscode.Memento, "get" | "update">;
}

export interface LegacyMigrationContext extends GlobalStateContext {
	readonly asAbsolutePath: vscode.ExtensionContext["asAbsolutePath"];
}

export interface GlobalStorageContext {
	readonly globalStorageUri: Pick<vscode.Uri, "fsPath">;
}

export interface InstallOutput {
	readonly appendLine: (message: string) => void;
}

export interface SubscriptionContext {
	readonly subscriptions: {
		readonly push: (...disposables: vscode.Disposable[]) => unknown;
	};
}

export const ClientModeSchema = Schema.Literals(["auto", "direct", "svelteExtension"]);

export type ClientMode = typeof ClientModeSchema.Type;
