const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export type TokenRefreshResult =
  | { success: true; accessToken: string; refreshToken?: string; expiresIn?: number }
  | { success: false };

/**
 * Exchange refresh token for new access token.
 * Required for session persistence (offline_access scope).
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string
): Promise<TokenRefreshResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) return { success: false };

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const accessToken = data.access_token;
  if (!accessToken) return { success: false };

  return {
    success: true,
    accessToken,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}
