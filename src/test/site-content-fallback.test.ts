import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { optionalContent } from "@/lib/optional-content";

const fetchContent = vi.fn<() => Promise<{ announcement: string }>>();
const CONTENT_DEFAULTS = { announcement: "Fallback" };

const siteContentQuery = {
  queryKey: ["site-content"],
  queryFn: () => optionalContent(fetchContent, { ...CONTENT_DEFAULTS }),
};

describe("Optional website content transport", () => {
  beforeEach(() => {
    fetchContent.mockReset();
  });

  it("lets the root loader resolve when the RPC fails before its handler runs", async () => {
    fetchContent.mockRejectedValue(new TypeError("Load failed"));
    const client = new QueryClient();
    const result = await client.ensureQueryData(siteContentQuery);
    expect(result).toEqual(CONTENT_DEFAULTS);
    expect(client.getQueryState(["site-content"])?.status).toBe("success");
    expect(fetchContent).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it("keeps successfully fetched owner-edited text", async () => {
    const saved = { ...CONTENT_DEFAULTS, announcement: "Saved business announcement" };
    fetchContent.mockResolvedValue(saved);
    const client = new QueryClient();
    expect(await client.ensureQueryData(siteContentQuery)).toEqual(saved);
    client.clear();
  });
});
