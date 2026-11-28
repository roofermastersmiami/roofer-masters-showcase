import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { instantInputSchema, instantRange, qualifyRoofLead } from "./instant-estimate-schema";
import { chatFetchSchema, chatMessageSchema, chatStartSchema, leadFormSchema } from "./lead-schema";
import { getPublicLeadCompanyId } from "./public-lead-company";

/**
 * tenant-audit: reviewed — privileged Supabase access is server-only. Public lead
 * writes derive company_id from validated server env, never request data; rate limits
 * include that company. Chat follow-ups require the per-lead opaque chat_token.
 */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const submitInstantEstimate = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ lead: leadFormSchema, input: instantInputSchema }).parse(raw),
  )
  .handler(async ({ data }) => {
    if (data.lead.company) throw new Error("Please try again.");
    if (data.lead.address.length < 5) throw new Error("Property address is required.");
    const companyId = getPublicLeadCompanyId();
    if (await tooManyRecent(data.lead.phone, data.lead.email, companyId))
      throw new Error("We already received your request. Please call 305-942-3093.");
    const db = await admin();
    const { data: rate, error: rateError } = await db
      .from("instant_roof_rates")
      .select("category,low_cents,high_cents,enabled")
      .eq("category", data.input.category)
      .maybeSingle();
    if (rateError) throw new Error("Please call 305-942-3093 to request your estimate.");
    const range = instantRange(data.input, rate);
    const qualification = {
      ...data.input,
      qualification: qualifyRoofLead(data.input),
      range,
      preliminary: true,
    };
    const summary = `Instant estimate request: ${data.input.sqft} sq ft, ${data.input.category}. ${data.input.county}; ${data.input.timeline}. ${data.input.owner ? "Owner/authorized representative" : "Owner authorization needed"}. Preferred language: ${data.input.language === "es" ? "Spanish" : "English"}. ${range ? `Preliminary range: $${(range.low / 100).toFixed(2)}–$${(range.high / 100).toFixed(2)}.` : "Team review required; no approved price available."}`;
    const { error } = await db.rpc("capture_instant_roof_lead", {
      p_lead: {
        company_id: companyId,
        name: data.lead.name,
        phone: data.lead.phone,
        email: data.lead.email,
        address: data.lead.address,
        message: summary,
      },
      p_qualification: qualification,
      p_category: data.input.category,
      p_total: range?.low ?? 0,
    });
    if (error) throw new Error("Could not save your request. Please call 305-942-3093.");
    return { range };
  });

/** Simple abuse guard: max 5 leads from the same phone/email in 10 minutes, per company. */
async function tooManyRecent(phone: string, email: string, companyId: string) {
  const db = await admin();
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const filters = [phone ? `phone.eq.${phone}` : "", email ? `email.eq.${email}` : ""]
    .filter(Boolean)
    .join(",");
  if (!filters) return false;
  const { count, error } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .gte("created_at", since)
    .or(filters);
  if (error || count === null) {
    console.error("Lead rate-limit check failed", error);
    throw new Error("We could not verify your request right now. Please call 305-942-3093.");
  }
  return count >= 5;
}

export const submitLead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => leadFormSchema.parse(data))
  .handler(async ({ data }) => {
    if (data.company) return { ok: true as const }; // bot: pretend success
    const companyId = getPublicLeadCompanyId();
    if (await tooManyRecent(data.phone, data.email, companyId)) {
      throw new Error("We already received your request. We'll be in touch shortly!");
    }
    const db = await admin();
    const { error } = await db.from("leads").insert({
      company_id: companyId,
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
    const companyId = getPublicLeadCompanyId();
    if (await tooManyRecent(data.phone, data.email, companyId)) {
      throw new Error("You've started several chats recently. Please call 305-942-3093.");
    }
    const db = await admin();
    const { data: lead, error } = await db
      .from("leads")
      .insert({
        company_id: companyId,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        message: data.message,
        source: "chat",
        page: "chat",
      })
      .select("id, chat_token, company_id")
      .single();
    if (error || !lead) {
      console.error("startChat failed", error);
      throw new Error("Chat is unavailable right now. Please call 305-942-3093.");
    }
    const { error: messageError } = await db.from("lead_messages").insert({
      lead_id: lead.id,
      company_id: lead.company_id,
      sender: "customer",
      body: data.message,
    });
    if (messageError) {
      console.error("startChat message insert failed", messageError);
      const { error: cleanupError } = await db
        .from("leads")
        .delete()
        .eq("id", lead.id)
        .eq("chat_token", lead.chat_token);
      if (cleanupError) console.error("startChat cleanup failed", cleanupError);
      throw new Error("Chat is unavailable right now. Please call 305-942-3093.");
    }
    return { leadId: lead.id, token: lead.chat_token };
  });

async function verifyChat(leadId: string, token: string) {
  const db = await admin();
  const { data, error } = await db
    .from("leads")
    .select("id, company_id")
    .eq("id", leadId)
    .eq("chat_token", token)
    .maybeSingle();
  if (error) {
    console.error("verifyChat failed", error);
    throw new Error("Could not verify your chat session. Please try again.");
  }
  if (!data) throw new Error("Chat session not found");
  if (!data.company_id) throw new Error("Chat company is not configured");
  return { db, companyId: data.company_id };
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatMessageSchema.parse(data))
  .handler(async ({ data }) => {
    const { db, companyId } = await verifyChat(data.leadId, data.token);
    const { error } = await db
      .from("lead_messages")
      .insert({ lead_id: data.leadId, company_id: companyId, sender: "customer", body: data.body });
    if (error) throw new Error("Message failed to send");
    return { ok: true as const };
  });

export const getChatMessages = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => chatFetchSchema.parse(data))
  .handler(async ({ data }) => {
    const { db, companyId } = await verifyChat(data.leadId, data.token);
    const { data: rows, error } = await db
      .from("lead_messages")
      .select("id, sender, body, created_at")
      .eq("lead_id", data.leadId)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("getChatMessages failed", error);
      throw new Error("Could not load chat messages. Please try again.");
    }
    return rows ?? [];
  });
