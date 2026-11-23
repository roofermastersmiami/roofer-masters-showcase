import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { authorizedClient } from "../supabase";
export default defineTool({
  name: "list_leads",
  title: "List roofing leads",
  description:
    "Read recent roofing leads permitted by your CRM team role, without chat tokens or private notes.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum recent leads to return, from 1 to 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const client = await authorizedClient(ctx, "leads");
    const { data, error } = await client
      .from("leads")
      .select("id,name,phone,email,address,service,status,pipeline_stage,created_at")
      .order("created_at", { ascending: false })
      .limit(limit)
      .abortSignal(ctx.signal);
    if (error) throw new ToolError("Could not read leads. Try again.");
    const leads = (data ?? []).map((row) => ({ ...row }));
    return {
      content: [{ type: "text", text: JSON.stringify({ leads }) }],
      structuredContent: { leads },
    };
  },
});
