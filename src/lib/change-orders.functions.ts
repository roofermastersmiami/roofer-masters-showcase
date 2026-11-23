import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { changeOrderSchema } from "./instant-estimate-schema";
export const createChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => changeOrderSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: owner, error: roleError } = await context.supabase.rpc("has_any_role", {
      _user_id: context.userId,
      _roles: ["accounting"],
    });
    if (roleError || !owner) throw new Error("You do not have access to this action");
    const { approved_by, ...fields } = data;
    const { error } = await context.supabase
      .from("job_change_orders")
      .insert({
        ...fields,
        approved_by: data.status === "approved" ? approved_by : null,
        approved_at: data.status === "approved" ? new Date().toISOString() : null,
      });
    if (error) throw new Error("Could not save change order");
    return { ok: true };
  });
