import { describe, expect, it, vi } from "vitest";
import { oauthReturnPath } from "@/lib/oauth-return-path";
import { authorizationResult, consentDecision, type ConsentProvider } from "@/lib/oauth-consent";
const provider = (): ConsentProvider => ({
  getAuthorizationDetails: vi.fn(async () => ({
    data: { client: { name: "Assistant" } },
    error: null,
  })),
  approveAuthorization: vi.fn(async () => ({
    data: { redirect_url: "https://client.example/callback?code=example" },
    error: null,
  })),
  denyAuthorization: vi.fn(async () => ({
    data: { redirect_to: "https://client.example/callback?error=access_denied" },
    error: null,
  })),
});
describe("OAuth consent return paths", () => {
  it("preserves the complete local consent target", () => {
    expect(oauthReturnPath("/.lovable/oauth/consent?authorization_id=abc#review")).toBe(
      "/.lovable/oauth/consent?authorization_id=abc#review",
    );
  });
  it("rejects external, network, backslash and control-character redirects", () => {
    for (const input of [
      "https://outside.invalid",
      "//outside.invalid",
      "/\\outside.invalid",
      "/auth\n",
      "/%2f%2foutside.invalid/../../\\outside.invalid",
    ])
      expect(oauthReturnPath(input)).toBe("/");
  });
  it("approve and deny use their respective provider actions", async () => {
    const p = provider();
    expect(await consentDecision(p, "authorization-id", true)).toContain("code=example");
    expect(p.approveAuthorization).toHaveBeenCalledWith("authorization-id");
    expect(p.denyAuthorization).not.toHaveBeenCalled();
    expect(await consentDecision(p, "authorization-id", false)).toContain("access_denied");
    expect(p.denyAuthorization).toHaveBeenCalledWith("authorization-id");
  });
  it("recognizes already-authorized redirects", () => {
    expect(
      authorizationResult({ data: { redirect_to: "https://client.example/callback" }, error: null })
        .redirect_to,
    ).toBe("https://client.example/callback");
  });
  it("missing, expired and provider lookup failures are failures", async () => {
    await expect(consentDecision(provider(), "", true)).rejects.toThrow("Missing");
    expect(() => authorizationResult({ data: null, error: null })).toThrow("expired");
    expect(() =>
      authorizationResult({ data: null, error: { message: "Provider unavailable" } }),
    ).toThrow("Provider unavailable");
  });
  it("failed approval and failed denial never become success", async () => {
    const p = provider();
    p.approveAuthorization = async () => ({ data: null, error: { message: "Approve failed" } });
    p.denyAuthorization = async () => ({ data: null, error: { message: "Deny failed" } });
    await expect(consentDecision(p, "id", true)).rejects.toThrow("Approve failed");
    await expect(consentDecision(p, "id", false)).rejects.toThrow("Deny failed");
  });
  it("rejects a missing provider destination", async () => {
    const p = provider();
    p.approveAuthorization = async () => ({ data: {}, error: null });
    await expect(consentDecision(p, "id", true)).rejects.toThrow("destination");
  });
});
