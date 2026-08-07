import createClient from "openapi-fetch";
import type { paths } from "../../lib/tmdb-api.js";
import { applyTmdbAuthentication } from "./auth.js";

let _tmdb: ReturnType<typeof createClient<paths>> | null = null;

const TMDB_REQUEST_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
	token: string,
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const requestUrl = new URL(
		typeof input === "string" ? input : input instanceof URL ? input : input.url,
	);
	const headers = new Headers(init?.headers);
	const authHeaders = applyTmdbAuthentication(requestUrl, token);
	for (const [name, value] of Object.entries(authHeaders)) {
		headers.set(name, value);
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TMDB_REQUEST_TIMEOUT_MS);
	try {
		return await fetch(requestUrl, { ...init, headers, signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
}

/** Build a TMDB client bound to a specific read-access token. */
export function createTmdbClient(token: string) {
	return createClient<paths>({
		baseUrl:
			process.env.PUBLIC_TMDB_API_BASE_URL || "https://api.themoviedb.org",
		fetch: (input, init) => fetchWithTimeout(token, input, init),
		headers: { accept: "application/json" },
	});
}

export function getTmdb() {
	if (!_tmdb) {
		if (!process.env.TMDB_API_TOKEN) {
			throw new Error("TMDB_API_TOKEN is not set");
		}
		_tmdb = createTmdbClient(process.env.TMDB_API_TOKEN);
	}
	return _tmdb;
}

/** @deprecated Use getTmdb() instead */
export const tmdb = new Proxy({} as ReturnType<typeof createClient<paths>>, {
	get(_, prop) {
		return (getTmdb() as any)[prop];
	},
});
