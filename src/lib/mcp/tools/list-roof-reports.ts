import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { authorizedClient } from "../supabase";
export default defineTool({
  name: "list_roof_reports",
  title: "List company roof reports",
  description:
    "Read company-owned roof report status and review dates; no report is created or ordered and no measurements are inferred.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum recent roof reports to return, from 1 to 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const client = await authorizedClient(ctx, "reports");
    const { data, error } = await client
      .from("roof_report_orders")
      .select("id,title,address,property_id,status,reviewed_at,created_at")
      .order("created_at", { ascending: false })
      .limit(limit)
      .abortSignal(ctx.signal);
    if (error) throw new ToolError("Could not read roof reports. Try again.");
    const reports = (data ?? []).map((row) => ({ ...row }));
    return {
      content: [{ type: "text", text: JSON.stringify({ reports }) }],
      structuredContent: { reports },
    };
  },
});
