import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  attemptPermitCustomerEmail,
  createPermitNotification,
  daysUntilExpiry,
  describePermit,
  expiryNotification,
  inspectionResultBody,
  permitExpiryDedupeKey,
  permitExpiryThreshold,
  permitStatusChangedBody,
  recordPermitActivity,
  sweepPermitExpirations,
  type PermitEmailTransport,
} from "@/lib/permit-notifications";

type InsertedRow = { table: string; values: Record<string, unknown> };

function fakeDb(
  onInsert?: (
    table: string,
    values: Record<string, unknown>,
  ) => { error: { code?: string; message?: string } | null } | undefined,
) {
  const inserts: InsertedRow[] = [];
  const db = {
    from: (table: string) => ({
      insert: async (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return onInsert?.(table, values) ?? { error: null };
      },
    }),
  };
  return { db: db as unknown as SupabaseClient, inserts };
}

const application = {
  permit_type: "Roof replacement",
  permit_number: "RM-2026-114",
  jurisdiction_name: "City of Miramar",
};

describe("permit notification copy", () => {
  it("describes a permit with number and jurisdiction", () => {
    expect(describePermit(application)).toBe(
      "Roof replacement permit RM-2026-114 (City of Miramar)",
    );
    expect(describePermit({ permit_type: "Roof repair" })).toBe("Roof repair permit");
    expect(describePermit({})).toBe("Permit");
  });

  it("builds status-change and inspection-result bodies", () => {
    expect(permitStatusChangedBody(application, "submitted", "issued")).toContain(
      "from submitted to issued",
    );
    expect(inspectionResultBody({ inspection_type: "Dry-in" }, application, "passed")).toContain(
      "Dry-in inspection passed",
    );
  });
});

describe("permit expiry thresholds", () => {
  const today = "2026-11-28";
  it("computes whole days until expiry", () => {
    expect(daysUntilExpiry("2026-12-12", today)).toBe(14);
    expect(daysUntilExpiry("2026-11-27", today)).toBe(-1);
    expect(daysUntilExpiry("not-a-date", today)).toBeNull();
  });
  it("fires at 14 days, 1 day, and after expiration only", () => {
    expect(permitExpiryThreshold("2026-12-13", today)).toBeNull(); // 15 days out
    expect(permitExpiryThreshold("2026-12-12", today)).toBe("14d"); // exactly 14
    expect(permitExpiryThreshold("2026-11-30", today)).toBe("14d"); // 2 days
    expect(permitExpiryThreshold("2026-11-29", today)).toBe("1d"); // 1 day
    expect(permitExpiryThreshold("2026-11-28", today)).toBe("1d"); // expires today
    expect(permitExpiryThreshold("2026-11-27", today)).toBe("expired");
    expect(permitExpiryThreshold("", today)).toBeNull();
  });
  it("builds stable dedupe keys and expiry copy", () => {
    expect(permitExpiryDedupeKey("app-1", "14d")).toBe("permit-expiry:app-1:14d");
    const soon = expiryNotification({ ...application, expires_at: "2026-12-05" }, "14d");
    expect(soon.kind).toBe("permit_expiring_soon");
    expect(soon.body).toContain("2026-12-05");
    const expired = expiryNotification({ ...application, expires_at: "2026-11-20" }, "expired");
    expect(expired.kind).toBe("permit_expired");
  });
});

describe("best-effort writers", () => {
  it("records activity rows with the permit kind and company scope", async () => {
    const { db, inserts } = fakeDb();
    await recordPermitActivity(db, { companyId: "co-1", leadId: "lead-1", body: "event" });
    expect(inserts).toEqual([
      {
        table: "crm_activity",
        values: { company_id: "co-1", lead_id: "lead-1", kind: "permit", body: "event" },
      },
    ]);
  });

  it("never throws when the activity insert fails", async () => {
    const { db } = fakeDb(() => {
      throw new Error("database unavailable");
    });
    await expect(
      recordPermitActivity(db, { companyId: "co-1", leadId: null, body: "event" }),
    ).resolves.toBeUndefined();
  });

  it("treats a dedupe conflict as an existing notification, not an error", async () => {
    const { db } = fakeDb(() => ({ error: { code: "23505", message: "duplicate key" } }));
    await expect(
      createPermitNotification(db, {
        companyId: "co-1",
        kind: "permit_expiring_soon",
        title: "t",
        body: "b",
        applicationId: "app-1",
        dedupeKey: "permit-expiry:app-1:14d",
      }),
    ).resolves.toBe(false);
  });

  it("returns true when a notification is inserted", async () => {
    const { db, inserts } = fakeDb();
    await expect(
      createPermitNotification(db, {
        companyId: "co-1",
        kind: "permit_status_changed",
        title: "t",
        body: "b",
        applicationId: "app-1",
      }),
    ).resolves.toBe(true);
    expect(inserts[0]?.values["dedupe_key"]).toBeNull();
  });
});

describe("customer email attempts", () => {
  const base = {
    companyId: "co-1",
    leadId: "lead-1",
    to: "homeowner@example.com",
    subject: "Permit update",
    message: "Hello",
  };

  it("logs a not-configured outcome and never claims a send", async () => {
    const { db, inserts } = fakeDb();
    const transport: PermitEmailTransport = {
      missingConfig: () => ["SMTP_HOST", "SMTP_PASSWORD"],
      send: async () => {
        throw new Error("must not be called");
      },
    };
    const outcome = await attemptPermitCustomerEmail(db, { ...base, transport });
    expect(outcome).toEqual({
      sent: false,
      reason: "not_configured",
      detail: "missing SMTP_HOST, SMTP_PASSWORD",
    });
    const activity = inserts.find((row) => row.table === "crm_activity");
    expect(String(activity?.values["body"])).toContain("not sent");
    expect(String(activity?.values["body"])).toContain("not configured");
  });

  it("logs a sent outcome only after the transport accepts", async () => {
    const { db, inserts } = fakeDb();
    let sentTo = "";
    const transport: PermitEmailTransport = {
      missingConfig: () => [],
      send: async (input) => {
        sentTo = input.to;
      },
    };
    const outcome = await attemptPermitCustomerEmail(db, { ...base, transport });
    expect(outcome).toEqual({ sent: true });
    expect(sentTo).toBe("homeowner@example.com");
    const activity = inserts.find((row) => row.table === "crm_activity");
    expect(String(activity?.values["body"])).toContain(
      "Customer email sent to homeowner@example.com",
    );
  });

  it("logs transport failures without throwing", async () => {
    const { db, inserts } = fakeDb();
    const transport: PermitEmailTransport = {
      missingConfig: () => [],
      send: async () => {
        throw new Error("SMTP connection timed out");
      },
    };
    const outcome = await attemptPermitCustomerEmail(db, { ...base, transport });
    expect(outcome).toMatchObject({ sent: false, reason: "transport_failed" });
    const activity = inserts.find((row) => row.table === "crm_activity");
    expect(String(activity?.values["body"])).toContain("failed to send");
  });
});

describe("expiration sweep", () => {
  const today = "2026-11-28";
  const apps = [
    {
      id: "app-soon",
      application_status: "issued",
      expires_at: "2026-12-05",
      ...application,
    },
    {
      id: "app-expired",
      application_status: "issued",
      expires_at: "2026-11-01",
      ...application,
    },
    {
      id: "app-far",
      application_status: "issued",
      expires_at: "2027-06-01",
      ...application,
    },
    {
      id: "app-draft",
      application_status: "draft",
      expires_at: "2026-11-01",
      ...application,
    },
    { id: "app-none", application_status: "issued", expires_at: null, ...application },
  ];

  it("creates one notification per permit at its current threshold", async () => {
    const { db, inserts } = fakeDb();
    const created = await sweepPermitExpirations(db, "co-1", apps, today);
    expect(created).toBe(2);
    const keys = inserts.map((row) => row.values["dedupe_key"]);
    expect(keys).toEqual(["permit-expiry:app-soon:14d", "permit-expiry:app-expired:expired"]);
  });

  it("creates nothing on a repeat sweep once notifications exist", async () => {
    const { db } = fakeDb(() => ({ error: { code: "23505", message: "duplicate key" } }));
    const created = await sweepPermitExpirations(db, "co-1", apps, today);
    expect(created).toBe(0);
  });
});
