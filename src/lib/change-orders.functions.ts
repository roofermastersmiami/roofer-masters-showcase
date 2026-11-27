import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { changeOrderSchema } from "./instant-estimate-schema";

export const createChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => changeOrderSchema.parse(raw))
  .handler(async ({ data, context }) => {
    // Resolve tenant ownership from the referenced job, never from client input.
    const { data: job, error: jobError } = await context.supabase
      .from("roof_jobs")
      .select("company_id")
      .eq("id", data.job_id)
      .maybeSingle();
    if (jobError) throw new Error("Could not verify the job's company");
    if (!job?.company_id) throw new Error("Choose a job owned by your company");

    const { data: membership, error: membershipError } = await context.supabase
      .from("crm_company_memberships")
      .select("role")
      .eq("company_id", job.company_id)
      .eq("user_id", context.userId)
      .in("role", ["owner", "admin", "accounting"])
      .maybeSingle();
    if (membershipError) throw new Error("Could not verify company permissions");
    if (!membership) throw new Error("You do not have access to this company's change orders");

    const { approved_by, ...fields } = data;
    const { error } = await context.supabase.from("job_change_orders").insert({
      ...fields,
      company_id: job.company_id,
      approved_by: data.status === "approved" ? approved_by : null,
      approved_at: data.status === "approved" ? new Date().toISOString() : null,
    });
    if (error) throw new Error("Could not save change order");
    return { ok: true };
  });
