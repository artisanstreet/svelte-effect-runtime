import type { RequestHandler } from "./$types";
import { redirect } from "@sveltejs/kit";

export const GET: RequestHandler = () => {
	redirect(307, "/redirected");
};
