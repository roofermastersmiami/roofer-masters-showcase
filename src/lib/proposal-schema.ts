import { z } from "zod";

export const ROOF_CATEGORIES = [
  "Metal Roof",
  "Tile Roof",
  "Shingle Roof",
  "TPO",
  "Flat Roof",
  "Roof Replacement",
  "Roof Repairs",
  "Gutters",
  "Other",
] as const;
export const proposalSchema = z.object({
  title: z.string().trim().min(1, "Enter a proposal title").max(160),
  category: z.enum(ROOF_CATEGORIES),
  is_template: z.boolean(),
  lead_id: z.string().uuid().nullable(),
  scope: z.string().max(20000),
  terms: z.string().max(20000),
  amount: z.number().finite().nonnegative().max(9999999999).nullable(),
});
export type ProposalDetails = z.infer<typeof proposalSchema>;

export function starterScope(category: string) {
  return `${category}\n\nProject scope\n• Roof measurements and existing roof assessment\n• Proposed roofing system and material specifications\n• Underlayment, flashing and ventilation details\n• Installation scope and site cleanup\n\nAdd project-specific quantities, exclusions and material selections.`;
}

export function validPdfHeader(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

export function shareIsActive(
  share: { revoked_at: string | null; expires_at: string },
  now = Date.now(),
) {
  return !share.revoked_at && new Date(share.expires_at).getTime() > now;
}

// Customer sign-off on a shared proposal: printed name plus a drawn PNG signature (data URL, capped in size).
export const signatureSchema = z.object({
  token: z.string().uuid(),
  name: z.string().trim().min(1, "Enter your full name").max(120),
  signature: z
    .string()
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Draw your signature")
    .max(400_000, "Signature image too large"),
});
export type ProposalSignature = z.infer<typeof signatureSchema>;
