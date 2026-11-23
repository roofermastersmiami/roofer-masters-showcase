import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { authorizedClient } from "../supabase";
export default defineTool({
  name: "list_invoices",
  title: "List invoices",
  description:
    "Read invoice totals and recorded paid amounts for Owner or Accounting only, filtered to test or live payments; excludes customer-link tokens.",
  inputSchema: {
    environment: z
      .enum(["test", "live"])
      .describe("Payment environment to read; test and live are never combined."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(20)
      .describe("Maximum recent invoices to return, from 1 to 50."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, environment }, ctx) => {
    const client = await authorizedClient(ctx, "invoices");
    const { data, error } = await client
      .from("crm_invoices")
      .select("id,number,title,customer_name,status,due_date,total_cents,paid_cents,environment")
      .eq("environment", environment)
      .order("created_at", { ascending: false })
      .limit(limit)
      .abortSignal(ctx.signal);
    if (error) throw new ToolError("Could not read invoices. Try again.");
    const invoices = (data ?? []).map((row) => ({ ...row }));
    return {
      content: [{ type: "text", text: JSON.stringify({ invoices }) }],
      structuredContent: { invoices },
    };
  },
});
