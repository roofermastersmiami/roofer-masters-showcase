import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
const ASSIGNABLE = ["office", "sales", "production_manager", "crew", "accounting"] as const;

async function listAuthUsers(supabaseAdmin: any) {
  const users: any[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) throw new Error("Could not load team accounts");
    users.push(...data.users);
    if (!data.nextPage || data.users.length === 0) return users;
    page = data.nextPage;
  }
}

async function gate(context: { supabase: any; userId: string }, roles: string[]) {
  const { data, error } = await context.supabase.rpc("has_any_role", {
    _user_id: context.userId,
    _roles: roles,
  });
  if (error || !data) throw new Error("You do not have access to this action");
}

/** Owner: list team accounts and roles. Only existing sign-ups appear; nobody is invited. */
export const listTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await gate(context, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error } = await supabaseAdmin.from("user_roles").select("user_id,role");
    if (error) throw new Error("Could not load team");
    const users = await listAuthUsers(supabaseAdmin);
    return users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      confirmed: !!u.email_confirmed_at,
      roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as string),
    }));
  });

export const setTeamRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        email: z.string().trim().email().max(255),
        role: z.enum(ASSIGNABLE),
        grant: z.boolean(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    await gate(context, ["admin"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const users = await listAuthUsers(supabaseAdmin);
    const user = users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
    if (!user || !user.email_confirmed_at)
      return {
        error:
          "No confirmed account with that email. Ask them to create an account at /auth and confirm their email first.",
      } as const;
    if (user.id === context.userId)
      return { error: "You cannot change your own owner access here." } as const;
    const q = data.grant
      ? supabaseAdmin
          .from("user_roles")
          .upsert({ user_id: user.id, role: data.role }, { onConflict: "user_id,role" })
      : supabaseAdmin.from("user_roles").delete().eq("user_id", user.id).eq("role", data.role);
    const { error } = await q;
    if (error) throw new Error("Could not update role");
    return { ok: true } as const;
  });

export const setJobCrew = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({ job_id: z.string().uuid(), user_ids: z.array(z.string().uuid()).max(30) })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    await gate(context, ["production_manager"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.user_ids.length) {
      const { data: crew, error: crewError } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("role", "crew")
        .in("user_id", data.user_ids);
      if (crewError || !crew) throw new Error("Could not verify crew assignments");
      if (crew.length !== new Set(data.user_ids).size)
        throw new Error("Only crew members can be assigned");
    }
    const { data: updated, error } = await context.supabase
      .from("roof_jobs")
      .update({ assigned_user_ids: data.user_ids })
      .eq("id", data.job_id)
      .select("id")
      .maybeSingle();
    if (error || !updated) throw new Error("Could not assign crew to that job");
    return { ok: true };
  });

/** Crew: only their assigned jobs, projected without prices, budgets, material costs or private notes. */
export const myCrewJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await gate(context, ["crew"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("roof_jobs")
      .select("id,title,status,start_date,inspection_at,permit_status,checklist,photos,property_id")
      .contains("assigned_user_ids", [context.userId])
      .order("start_date", { ascending: true });
    if (error) throw new Error("Could not load jobs");
    const ids = [
      ...new Set((data ?? []).map((j) => j.property_id).filter((x): x is string => !!x)),
    ];
    const { data: props, error: propsError } = ids.length
      ? await supabaseAdmin.from("crm_properties").select("id,address").in("id", ids)
      : { data: [], error: null };
    if (propsError) throw new Error("Could not load assigned job addresses");
    return (data ?? []).map((j) => ({
      ...j,
      address: props?.find((p) => p.id === j.property_id)?.address ?? "",
    }));
  });
