/**
 * TMDB supports both a v4 read-access token and a legacy v3 API key.
 * This deployment keeps the existing secret name while supporting either value.
 */
export function applyTmdbAuthentication(
	url: URL,
	token: string,
): Record<string, string> {
	// A 32-character hexadecimal value is the legacy TMDB v3 API key format.
	const isLegacyApiKey = /^[a-f0-9]{32}$/i.test(token);
	if (isLegacyApiKey) {
		url.searchParams.set("api_key", token);
		return { accept: "application/json" };
	}

	return {
		accept: "application/json",
		Authorization: `Bearer ${token}`,
	};
}
