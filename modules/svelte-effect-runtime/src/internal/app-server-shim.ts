export function getRequestEvent(): never {
  throw new Error("$app/server is only available inside a SvelteKit app.");
}

export function query(..._args: Array<unknown>): never {
  throw new Error("$app/server is only available inside a SvelteKit app.");
}

query.batch = (..._args: Array<unknown>): never => {
  throw new Error("$app/server is only available inside a SvelteKit app.");
};

export function command(..._args: Array<unknown>): never {
  throw new Error("$app/server is only available inside a SvelteKit app.");
}

export function form(..._args: Array<unknown>): never {
  throw new Error("$app/server is only available inside a SvelteKit app.");
}

export function prerender(..._args: Array<unknown>): never {
  throw new Error("$app/server is only available inside a SvelteKit app.");
}
