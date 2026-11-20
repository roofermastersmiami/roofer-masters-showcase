import { createServerFn } from "@tanstack/react-start";
import {
  chatFetchSchema,
  chatMessageSchema,
  chatStartSchema,
  leadFormSchema,
} from "./lead-schema";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Simple abuse guard: max 5 leads from the same phone/email in 10 minutes. */
async function tooManyRecent(phone: string, email: string) {
  const db = await admin();
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const filters = [phone ? `phone.eq.${phone}` : "", email ? `email.eq.${email}` : ""]
    .filter(Boolean)
    .join(",");
  if (!filters) return false;
  const { count } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .or(filters);
  return (count ?? 0) >= 5;
}

export const submitLead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => leadFormSchema.parse(data))
  .handler(async ({ data }) => {
    if (data.company) return { ok: true as const }; // bot: pretend success
    if (await tooManyRecent(data.phone, data.email)) {
      throw new Error("We already received your request. We'll be in touch shortly!");
    }
    const db = await admin();
    const { error } = await db.from("leads").insert({
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      address: data.address || null,
      service: data.service || null,
      message: data.message || null,
      source: data.source,
      page: data.page || null,
    });
    if (error) {
      console.error("submitLead failed", error);
      throw new Error("Something went wrong. Please call us at 305-942-3093.");
    }
    return { ok: true as const };
  });

export const startChat = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatStartSchema.parse(data))
  .handler(async ({ data }) => {
    if (await tooManyRecent(data.phone, data.email)) {
      throw new Error("You've started several chats recently. Please call 305-942-3093.");
    }
    const db = await admin();
    const { data: lead, error } = await db
      .from("leads")
      .insert({
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        message: data.message,
        source: "chat",
        page: "chat",
      })
      .select("id, chat_token")
      .single();
    if (error || !lead) {
      console.error("startChat failed", error);
      throw new Error("Chat is unavailable right now. Please call 305-942-3093.");
    }
    await db
      .from("lead_messages")
      .insert({ lead_id: lead.id, sender: "customer", body: data.message });
    return { leadId: lead.id, token: lead.chat_token };
  });

async function verifyChat(leadId: string, token: string) {
  const db = await admin();
  const { data } = await db
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("chat_token", token)
    .maybeSingle();
  if (!data) throw new Error("Chat session not found");
  return db;
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatMessageSchema.parse(data))
  .handler(async ({ data }) => {
    const db = await verifyChat(data.leadId, data.token);
    const { error } = await db
      .from("lead_messages")
      .insert({ lead_id: data.leadId, sender: "customer", body: data.body });
    if (error) throw new Error("Message failed to send");
    return { ok: true as const };
  });

export const getChatMessages = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatFetchSchema.parse(data))
  .handler(async ({ data }) => {
    const db = await verifyChat(data.leadId, data.token);
    const { data: rows } = await db
      .from("lead_messages")
      .select("id, sender, body, created_at")
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: true })
      .limit(200);
    return rows ?? [];
  });
