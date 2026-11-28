import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Permitting automation: audit-trail bodies, in-app notification copy,
 * expiration thresholds, and the best-effort writers used by
 * `permitting.functions.ts`.
 *
 * Design rules (mirroring the rest of the CRM):
 * - Every row is company-scoped; the caller derives `companyId` from the
 *   authenticated user's membership (`permitContext`), never from input.
 * - Writers are best-effort and never throw: a failed audit/notification
 *   insert must not mask a permit update that already succeeded, and an
 *   email failure must never crash the workflow that triggered it.
 * - Email outcomes are recorded honestly in the activity log — a send is
 *   only "sent" when the SMTP transport accepted it; "not configured" and
 *   transport failures are logged as what they are.
 */

export type PermitApplicationSummary = {
  permit_type?: string | null;
  permit_number?: string | null;
  jurisdiction_name?: string | null;
};

export type PermitInspectionSummary = {
  inspection_type?: string | null;
  scheduled_at?: string | null;
  confirmation_number?: string | null;
};

export type ProductApprovalSummary = {
  approval_kind?: string | null;
  approval_number?: string | null;
  manufacturer?: string | null;
  product_name?: string | null;
};

export function describePermit(application: PermitApplicationSummary): string {
  const type = (application.permit_type ?? "").trim();
  const number = (application.permit_number ?? "").trim();
  const jurisdiction = (application.jurisdiction_name ?? "").trim();
  let label = type ? `${type} permit` : "Permit";
  if (number) label += ` ${number}`;
  if (jurisdiction) label += ` (${jurisdiction})`;
  return label;
}

function formatWhen(value?: string | null): string {
  if (!value) return "date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "date not recorded" : date.toISOString();
}

// ---------------------------------------------------------------------------
// Audit-trail bodies (crm_activity, kind "permit")
// ---------------------------------------------------------------------------

export function permitCreatedBody(application: PermitApplicationSummary): string {
  return `Permit application created: ${describePermit(application)} started as a draft.`;
}

export function permitStatusChangedBody(
  application: PermitApplicationSummary,
  fromStatus: string,
  toStatus: string,
): string {
  return `Permit status changed from ${fromStatus} to ${toStatus}: ${describePermit(application)}.`;
}

export function inspectionRequestedBody(
  inspection: PermitInspectionSummary,
  application: PermitApplicationSummary,
): string {
  const type = (inspection.inspection_type ?? "").trim() || "Inspection";
  return `${type} inspection requested for ${describePermit(application)}.`;
}

export function inspectionScheduledBody(
  inspection: PermitInspectionSummary,
  application: PermitApplicationSummary,
): string {
  const type = (inspection.inspection_type ?? "").trim() || "Inspection";
  const confirmation = (inspection.confirmation_number ?? "").trim();
  return (
    `${type} inspection scheduled for ${describePermit(application)} at ${formatWhen(inspection.scheduled_at)}.` +
    (confirmation ? ` Confirmation number: ${confirmation}.` : "")
  );
}

export function inspectionResultBody(
  inspection: PermitInspectionSummary,
  application: PermitApplicationSummary,
  result: "passed" | "failed",
): string {
  const type = (inspection.inspection_type ?? "").trim() || "Inspection";
  return `${type} inspection ${result} for ${describePermit(application)}.`;
}

export function documentAddedBody(application: PermitApplicationSummary, fileName: string): string {
  return `Permit document added: ${fileName} attached to ${describePermit(application)}.`;
}

export function productApprovalRecordedBody(
  approval: ProductApprovalSummary,
  application: PermitApplicationSummary,
): string {
  const product = [approval.manufacturer, approval.product_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const number = (approval.approval_number ?? "").trim();
  return `Product approval recorded for ${describePermit(application)}: ${product || "product"}${number ? ` (approval ${number})` : ""}.`;
}

export function productApprovalVerifiedBody(
  approval: ProductApprovalSummary,
  application: PermitApplicationSummary,
): string {
  const number = (approval.approval_number ?? "").trim();
  return `Product approval verified for ${describePermit(application)}${number ? `: approval ${number}` : ""}.`;
}

// ---------------------------------------------------------------------------
// In-app notification copy
// ---------------------------------------------------------------------------

export type PermitNotificationKind =
  | "permit_status_changed"
  | "inspection_scheduled"
  | "inspection_result"
  | "permit_expiring_soon"
  | "permit_expired";

export function statusChangeNotification(
  application: PermitApplicationSummary,
  fromStatus: string,
  toStatus: string,
): { kind: PermitNotificationKind; title: string; body: string } {
  return {
    kind: "permit_status_changed",
    title: `Permit ${toStatus}: ${describePermit(application)}`,
    body: permitStatusChangedBody(application, fromStatus, toStatus),
  };
}

export function inspectionScheduledNotification(
  inspection: PermitInspectionSummary,
  application: PermitApplicationSummary,
): { kind: PermitNotificationKind; title: string; body: string } {
  const type = (inspection.inspection_type ?? "").trim() || "Inspection";
  return {
    kind: "inspection_scheduled",
    title: `${type} inspection scheduled: ${describePermit(application)}`,
    body: inspectionScheduledBody(inspection, application),
  };
}

export function inspectionResultNotification(
  inspection: PermitInspectionSummary,
  application: PermitApplicationSummary,
  result: "passed" | "failed",
): { kind: PermitNotificationKind; title: string; body: string } {
  const type = (inspection.inspection_type ?? "").trim() || "Inspection";
  return {
    kind: "inspection_result",
    title: `${type} inspection ${result}: ${describePermit(application)}`,
    body: inspectionResultBody(inspection, application, result),
  };
}

// ---------------------------------------------------------------------------
// Expiration thresholds
// ---------------------------------------------------------------------------

export type PermitExpiryThreshold = "expired" | "1d" | "14d";

const DAY_MS = 86_400_000;

function dateOnlyMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : ms;
}

/** Whole days from `today` until `expiresAt` (negative once expired). */
export function daysUntilExpiry(expiresAt: string, today: string): number | null {
  const expiry = dateOnlyMs(expiresAt);
  const now = dateOnlyMs(today);
  if (expiry === null || now === null) return null;
  return Math.round((expiry - now) / DAY_MS);
}

/**
 * The most urgent threshold an expiration date has reached, or null when
 * the permit is more than 14 days out. Each threshold fires once per
 * permit (see the dedupe key), so a permit notifies at 14 days, again at
 * 1 day, and again once expired.
 */
export function permitExpiryThreshold(
  expiresAt: string,
  today: string,
): PermitExpiryThreshold | null {
  const days = daysUntilExpiry(expiresAt, today);
  if (days === null) return null;
  if (days < 0) return "expired";
  if (days <= 1) return "1d";
  if (days <= 14) return "14d";
  return null;
}

export function permitExpiryDedupeKey(
  applicationId: string,
  threshold: PermitExpiryThreshold,
): string {
  return `permit-expiry:${applicationId}:${threshold}`;
}

export function expiryNotification(
  application: PermitApplicationSummary & { expires_at?: string | null },
  threshold: PermitExpiryThreshold,
): { kind: PermitNotificationKind; title: string; body: string } {
  const label = describePermit(application);
  const expires = (application.expires_at ?? "").trim() || "its recorded expiration date";
  if (threshold === "expired") {
    return {
      kind: "permit_expired",
      title: `Permit expired: ${label}`,
      body: `${label} passed its expiration date (${expires}) and has not been renewed or closed in the CRM.`,
    };
  }
  const days = threshold === "1d" ? "1 day or less" : "14 days or less";
  return {
    kind: "permit_expiring_soon",
    title: `Permit expiring soon: ${label}`,
    body: `${label} expires on ${expires} — within ${days}.`,
  };
}

// ---------------------------------------------------------------------------
// Customer email copy
// ---------------------------------------------------------------------------

export function permitStatusChangeEmail(
  application: PermitApplicationSummary,
  toStatus: string,
  customerName: string,
): { subject: string; message: string } {
  const label = describePermit(application);
  return {
    subject: `Permit update: your ${application.permit_type ?? "roofing"} permit is now ${toStatus}`,
    message:
      `Hello ${customerName},\n\n` +
      `This is an update from Roofer Masters about the permit for your roofing project.\n\n` +
      `${label} — current status: ${toStatus}.\n\n` +
      `If you have any questions, just reply to this email or call us.\n\n` +
      `Thank you,\nRoofer Masters`,
  };
}

export function inspectionResultEmail(
  inspection: PermitInspectionSummary,
  application: PermitApplicationSummary,
  result: "passed" | "failed",
  customerName: string,
): { subject: string; message: string } {
  const type = (inspection.inspection_type ?? "").trim() || "Inspection";
  const label = describePermit(application);
  return {
    subject: `Inspection update: ${type} ${result} for your roofing project`,
    message:
      `Hello ${customerName},\n\n` +
      `This is an update from Roofer Masters about an inspection on your roofing project.\n\n` +
      `${type} inspection for ${label} — result: ${result}.\n\n` +
      `If you have any questions, just reply to this email or call us.\n\n` +
      `Thank you,\nRoofer Masters`,
  };
}

// ---------------------------------------------------------------------------
// Best-effort writers (never throw)
// ---------------------------------------------------------------------------

type InsertResult = { error: { code?: string; message?: string } | null };

/** Write one row to the company activity feed (crm_activity, kind "permit"). */
export async function recordPermitActivity(
  db: SupabaseClient,
  input: { companyId: string; leadId: string | null; body: string },
): Promise<void> {
  try {
    await db.from("crm_activity").insert({
      company_id: input.companyId,
      lead_id: input.leadId,
      kind: "permit",
      body: input.body,
    });
  } catch {
    // Audit logging is best-effort: the permit change itself already
    // succeeded and must not be reported as failed because of the log.
  }
}

/**
 * Create an in-app notification for the company's owners/admins.
 * Returns true when a row was inserted; a dedupe-key conflict (the
 * notification already exists) or any other failure returns false.
 */
export async function createPermitNotification(
  db: SupabaseClient,
  input: {
    companyId: string;
    kind: PermitNotificationKind;
    title: string;
    body: string;
    applicationId: string | null;
    dedupeKey?: string | null;
  },
): Promise<boolean> {
  try {
    const { error } = (await db.from("crm_notifications").insert({
      company_id: input.companyId,
      kind: input.kind,
      title: input.title,
      body: input.body,
      permit_application_id: input.applicationId,
      dedupe_key: input.dedupeKey ?? null,
    })) as InsertResult;
    return !error;
  } catch {
    return false;
  }
}

export type PermitEmailTransport = {
  missingConfig: () => string[];
  send: (input: { to: string; subject: string; message: string }) => Promise<unknown>;
};

export type PermitEmailOutcome =
  | { sent: true }
  | { sent: false; reason: "not_configured" | "transport_failed"; detail: string };

/**
 * Attempt a customer email through the CRM's SMTP transport and record
 * the real outcome in the activity log. Never throws and never claims a
 * send the transport did not accept.
 */
export async function attemptPermitCustomerEmail(
  db: SupabaseClient,
  input: {
    companyId: string;
    leadId: string | null;
    to: string;
    subject: string;
    message: string;
    transport: PermitEmailTransport;
  },
): Promise<PermitEmailOutcome> {
  const missing = input.transport.missingConfig();
  if (missing.length) {
    const detail = `missing ${missing.join(", ")}`;
    await recordPermitActivity(db, {
      companyId: input.companyId,
      leadId: input.leadId,
      body: `Customer email not sent — email is not configured on the server (${detail}). Subject: "${input.subject}".`,
    });
    return { sent: false, reason: "not_configured", detail };
  }
  try {
    await input.transport.send({ to: input.to, subject: input.subject, message: input.message });
    await recordPermitActivity(db, {
      companyId: input.companyId,
      leadId: input.leadId,
      body: `Customer email sent to ${input.to}: "${input.subject}".`,
    });
    return { sent: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown transport error";
    await recordPermitActivity(db, {
      companyId: input.companyId,
      leadId: input.leadId,
      body: `Customer email failed to send to ${input.to} (${detail}). Subject: "${input.subject}".`,
    });
    return { sent: false, reason: "transport_failed", detail };
  }
}

/**
 * Expiration sweep: for every issued application with an expiration date,
 * create the notification for the most urgent threshold it has reached.
 * The (company_id, dedupe_key) unique index makes each threshold fire
 * exactly once per permit, however often the sweep runs. Returns how
 * many notifications were newly created.
 */
export async function sweepPermitExpirations(
  db: SupabaseClient,
  companyId: string,
  applications: Array<
    PermitApplicationSummary & {
      id: string;
      application_status: string;
      expires_at?: string | null;
    }
  >,
  today: string,
): Promise<number> {
  let created = 0;
  for (const application of applications) {
    if (application.application_status !== "issued") continue;
    if (!application.expires_at) continue;
    const threshold = permitExpiryThreshold(application.expires_at, today);
    if (!threshold) continue;
    const copy = expiryNotification(application, threshold);
    const inserted = await createPermitNotification(db, {
      companyId,
      kind: copy.kind,
      title: copy.title,
      body: copy.body,
      applicationId: application.id,
      dedupeKey: permitExpiryDedupeKey(application.id, threshold),
    });
    if (inserted) created += 1;
  }
  return created;
}
