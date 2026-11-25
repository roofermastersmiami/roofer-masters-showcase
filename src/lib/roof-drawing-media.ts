import { z } from "zod";
import { isSafeRoofMediaPath } from "./roof-media";

/**
 * Metadata needed to place saved aerial imagery back on the same georeferenced
 * roof drawing after it is reopened. Zod strips unknown object keys, so keep
 * this server boundary schema aligned with the CRM Media shape.
 */
export const roofDrawingMediaSchema = z
  .array(
    z.object({
      path: z
        .string()
        .min(1)
        .max(300)
        .refine(isSafeRoofMediaPath, "Invalid media storage path"),
      name: z.string().trim().min(1).max(200),
      category: z.enum(["aerial", "before", "after", "diagram"]),
      feet_per_pixel: z.number().finite().positive().max(10).optional(),
      source: z.string().trim().min(1).max(80).optional(),
      matched_address: z.string().trim().min(1).max(250).optional(),
      latitude: z.number().finite().min(-90).max(90).optional(),
      longitude: z.number().finite().min(-180).max(180).optional(),
    }),
  )
  .max(30);
