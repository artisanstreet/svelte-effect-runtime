export interface NavLink {
	readonly href: string;
	readonly label: string;
}

export interface NavGroup {
	readonly title: string;
	readonly description: string;
	readonly links: ReadonlyArray<NavLink>;
}

export const NAV: ReadonlyArray<NavGroup> = [
	{
		title: "Form",
		description: "Spreadable form objects with Effect submission.",
		links: [
			{ href: "/form/basic-spread", label: "Basic spread" },
			{ href: "/form/programmatic", label: "Programmatic .submit()" },
			{ href: "/form/for-loop", label: ".for(id) in {#each}" },
			{ href: "/form/enhance", label: "Custom .enhance()" },
			{ href: "/form/validation", label: "Validation issues" },
			{ href: "/form/unchecked", label: 'Form("unchecked")' },
			{ href: "/form/no-input", label: "Void-input form" },
			{ href: "/form/effect-pipe", label: "submit().pipe(matchCause)" },
			{ href: "/form/descriptor", label: "Descriptor diagnostics" }
		]
	},
	{
		title: "Query",
		description: "Read-only remote functions returning Effects.",
		links: [
			{ href: "/query/basic", label: "Basic (no args)" },
			{ href: "/query/schema", label: "Schema-validated" },
			{ href: "/query/unchecked", label: 'Query("unchecked")' },
			{ href: "/query/error-handling", label: "Error handling" }
		]
	},
	{
		title: "Command",
		description: "Write-oriented remote functions.",
		links: [
			{ href: "/command/basic", label: "Schema-validated" },
			{ href: "/command/void", label: "Void input" },
			{ href: "/command/pending", label: "Pending state" },
			{ href: "/command/error-handling", label: "Error handling" }
		]
	},
	{
		title: "Prerender",
		description: "Build-time evaluated remote functions.",
		links: [
			{ href: "/prerender/basic", label: "Static at build" },
			{ href: "/prerender/dynamic", label: "Dynamic refresh" }
		]
	}
];
