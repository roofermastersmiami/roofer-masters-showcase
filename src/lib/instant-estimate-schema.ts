import { z } from "zod";
export const ROOF_TYPES = ["Metal Roof", "Tile Roof", "Shingle Roof", "TPO", "Flat Roof"] as const;
export const instantInputSchema = z.object({
  category: z.enum(ROOF_TYPES),
  sqft: z.number().min(100).max(100000),
  county: z.enum(["Miami-Dade", "Broward", "Other"]),
  timeline: z.enum(["Urgent", "Within 30 days", "1–3 months", "Planning"]),
  owner: z.boolean(),
  language: z.enum(["en", "es"]),
});
export const rateSchema = z
  .object({
    category: z.enum(ROOF_TYPES),
    low_cents: z.number().int().positive().max(10000000),
    high_cents: z.number().int().positive().max(10000000),
    enabled: z.boolean(),
  })
  .refine((v) => v.high_cents >= v.low_cents, "Maximum must be at least the minimum");
export function instantRange(input: z.infer<typeof instantInputSchema>, rawRate: unknown) {
  const checked = instantInputSchema.parse(input);
  if (checked.county === "Other") return null;
  const parsedRate = rateSchema.safeParse(rawRate);
  if (
    !parsedRate.success ||
    !parsedRate.data.enabled ||
    parsedRate.data.category !== checked.category
  )
    return null;
  const rate = parsedRate.data;
  return {
    low: Math.round((checked.sqft / 100) * rate.low_cents),
    high: Math.round((checked.sqft / 100) * rate.high_cents),
  };
}
export function qualifyRoofLead(input: z.infer<typeof instantInputSchema>) {
  return input.county === "Other"
    ? "outside_service_area"
    : !input.owner
      ? "owner_authorization_needed"
      : input.timeline === "Urgent"
        ? "urgent"
        : "qualified";
}
export const changeOrderSchema = z
  .object({
    job_id: z.string().uuid(),
    title: z.string().trim().min(1).max(180),
    scope: z.string().trim().min(1).max(4000),
    amount_cents: z.number().int().min(-100000000).max(100000000),
    days_added: z.number().int().min(-365).max(365),
    status: z.enum(["draft", "pending", "approved", "rejected"]),
    approved_by: z.string().trim().max(100),
  })
  .refine(
    (v) => v.status !== "approved" || v.approved_by.length >= 2,
    "Record the customer name before approving",
  );
