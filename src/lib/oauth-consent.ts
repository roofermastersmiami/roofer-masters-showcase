export interface AuthorizationDetails {
  client?: { name?: string; client_name?: string; redirect_uri?: string };
  redirect_uri?: string;
  scope?: string;
  scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
}
export interface OAuthResult {
  data: AuthorizationDetails | null;
  error: { message: string } | null;
}
export interface ConsentProvider {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
}
export function authorizationResult(result: OAuthResult): AuthorizationDetails {
  if (result.error) throw new Error(result.error.message);
  if (!result.data)
    throw new Error(
      "This connection request is unavailable or expired. Start again from your assistant.",
    );
  return result.data;
}
export async function consentDecision(
  provider: ConsentProvider,
  id: string,
  approve: boolean,
): Promise<string> {
  if (!id) throw new Error("Missing connection request. Start again from your assistant.");
  const details = authorizationResult(
    await (approve ? provider.approveAuthorization(id) : provider.denyAuthorization(id)),
  );
  const target = details.redirect_url ?? details.redirect_to;
  if (!target) throw new Error("The connection service did not return a destination. Try again.");
  return target;
}
