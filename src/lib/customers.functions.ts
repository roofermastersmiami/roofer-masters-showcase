import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { customerSchema } from "./crm-foundation";
export const saveCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => customerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("save_crm_customer", {
      p_customer: data,
    });
    if (error || !id) throw new Error("Could not save this customer");
    return { id };
  });

/** Delete only an unlinked CRM customer; the source lead is retained. */
export const deleteCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: deletedId, error } = await context.supabase.rpc("delete_crm_customer", {
      p_customer_id: data.id,
    });
    if (error || !deletedId) {
      throw new Error(error?.message || "Could not delete this customer");
    }
    return { id: deletedId };
  });
