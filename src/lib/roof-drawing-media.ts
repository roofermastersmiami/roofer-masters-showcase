import { z } from "zod";
import { isSafeRoofMediaPath } from "./roof-media";

export type RoofDrawingMedia = {
  path: string;
  name: string;
  category: "aerial" | "before" | "after" | "diagram";
  source?: string;
  matched_address?: string;
  latitude?: number;
  longitude?: number;
};

/** Keep persisted aerial metadata available when a drawing is reopened. */
export const roofDrawingMediaSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(300).refine(isSafeRoofMediaPath, "Invalid media storage path"),
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

/** Restore the persisted JSON media column into the typed workspace model. */
export function restoreRoofDrawingMedia(value: unknown): RoofDrawingMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof item.path !== "string" ||
      typeof item.name !== "string" ||
      !["aerial", "before", "after", "diagram"].includes(String(item.category))
    ) {
      return [];
    }
    const latitude =
      typeof item.latitude === "number" &&
      Number.isFinite(item.latitude) &&
      item.latitude >= -90 &&
      item.latitude <= 90
        ? item.latitude
        : undefined;
    const longitude =
      typeof item.longitude === "number" &&
      Number.isFinite(item.longitude) &&
      item.longitude >= -180 &&
      item.longitude <= 180
        ? item.longitude
        : undefined;
    return [
      {
        path: item.path,
        name: item.name,
        category: item.category as RoofDrawingMedia["category"],
        ...(typeof item.source === "string" ? { source: item.source.slice(0, 80) } : {}),
        ...(typeof item.matched_address === "string"
          ? { matched_address: item.matched_address.slice(0, 250) }
          : {}),
        ...(latitude !== undefined ? { latitude } : {}),
        ...(longitude !== undefined ? { longitude } : {}),
      },
    ];
  });
}
