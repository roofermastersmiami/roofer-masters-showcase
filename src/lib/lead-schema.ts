import { z } from "zod";

export const LEAD_STATUSES = ["new", "contacted", "estimate_sent", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  estimate_sent: "Estimate Sent",
  won: "Won",
  lost: "Lost",
};

export const LEAD_SOURCES = ["callback", "contact", "quote", "chat"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  callback: "Call-back request",
  contact: "Contact form",
  quote: "Quote request",
  chat: "Website chat",
};

const phoneRegex = /^[0-9+()\-.\s]{7,20}$/;

export const leadFormSchema = z
  .object({
  name: z.string().trim().min(2, "Please enter your name").max(100),
  phone: z
    .string()
    .trim()
    .regex(phoneRegex, "Please enter a valid phone number"),
  email: z
    .string()
    .trim()
    .max(255)
    .email("Please enter a valid email")
    .or(z.literal("")),
  address: z.string().trim().max(250).optional().default(""),
  service: z.string().trim().max(100).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  source: z.enum(["callback", "contact", "quote"]),
  page: z.string().trim().max(200).optional().default(""),
  // Honeypot: real visitors never fill this in.
  company: z.string().max(0).optional().default(""),
  })
  // Call-back requests must say where the property is.
  .refine((v) => v.source !== "callback" || v.address.length >= 5, {
    message: "Please enter the property address",
    path: ["address"],
  });
export type LeadFormInput = z.input<typeof leadFormSchema>;

export const chatStartSchema = z
  .object({
    name: z.string().trim().min(2, "Please enter your name").max(100),
    phone: z.string().trim().regex(phoneRegex, "Enter a valid phone").or(z.literal("")),
    email: z.string().trim().max(255).email("Enter a valid email").or(z.literal("")),
    message: z.string().trim().min(1, "Type a message").max(2000),
  })
  .refine((v) => v.phone !== "" || v.email !== "", {
    message: "Add a phone or email so we can reply",
    path: ["phone"],
  });

export const chatMessageSchema = z.object({
  leadId: z.string().uuid(),
  token: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export const chatFetchSchema = z.object({
  leadId: z.string().uuid(),
  token: z.string().uuid(),
});
