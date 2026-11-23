import { describe, expect, it } from "vitest";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  chatStartSchema,
  leadFormSchema,
} from "@/lib/lead-schema";
import { BUSINESS } from "@/lib/site";

describe("lead rules", () => {
  it("pipeline stages are New, Contacted, Estimate Sent, Won, Lost in order", () => {
    expect(LEAD_STATUSES.map((s) => LEAD_STATUS_LABELS[s])).toEqual([
      "New",
      "Contacted",
      "Estimate Sent",
      "Won",
      "Lost",
    ]);
  });

  it("a call-back request needs a phone number", () => {
    const r = leadFormSchema.safeParse({
      name: "Ana Perez",
      phone: "",
      email: "",
      source: "callback",
    });
    expect(r.success).toBe(false);
  });

  it("a call-back request with name, phone and address is accepted", () => {
    const r = leadFormSchema.safeParse({
      name: "Ana Perez",
      phone: "305-555-0123",
      email: "",
      address: "123 SW 1st St, Homestead, FL 33030",
      source: "callback",
    });
    expect(r.success).toBe(true);
  });

  it("a call-back request without an address is rejected", () => {
    const r = leadFormSchema.safeParse({
      name: "Ana Perez",
      phone: "305-555-0123",
      email: "",
      address: "",
      source: "callback",
    });
    expect(r.success).toBe(false);
  });

  it("a contact form does not require an address", () => {
    const r = leadFormSchema.safeParse({
      name: "Ana Perez",
      phone: "305-555-0123",
      email: "",
      source: "contact",
    });
    expect(r.success).toBe(true);
  });

  it("a chat needs a phone or email so the owner can reply", () => {
    const r = chatStartSchema.safeParse({ name: "Ana", phone: "", email: "", message: "Hi" });
    expect(r.success).toBe(false);
  });

  it("rejects submissions that fill the hidden company honeypot", () => {
    const result = leadFormSchema.safeParse({
      name: "Ana Perez",
      phone: "305-555-0123",
      email: "",
      source: "contact",
      company: "Spam business",
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed phone numbers and overlong lead messages", () => {
    expect(
      leadFormSchema.safeParse({
        name: "Ana Perez",
        phone: "call me tomorrow",
        email: "",
        source: "contact",
      }).success,
    ).toBe(false);
    expect(
      leadFormSchema.safeParse({
        name: "Ana Perez",
        phone: "305-555-0123",
        email: "",
        source: "contact",
        message: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("requires a valid reply address and bounded message for website chat", () => {
    expect(
      chatStartSchema.safeParse({
        name: "Ana Perez",
        phone: "",
        email: "not-an-email",
        message: "Hello",
      }).success,
    ).toBe(false);
    expect(
      chatStartSchema.safeParse({
        name: "Ana Perez",
        phone: "305-555-0123",
        email: "",
        message: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("business phone is 305-942-3093", () => {
    expect(BUSINESS.phoneDisplay).toBe("305-942-3093");
    expect(BUSINESS.phoneHref).toBe("tel:+13059423093");
  });
});
