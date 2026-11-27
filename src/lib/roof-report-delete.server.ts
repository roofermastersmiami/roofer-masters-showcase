import { isSafeRoofMediaPath } from "./roof-media";

/**
 * Complete, tenant-scoped deletion of one roof report.
 *
 * The caller-facing server function wires the reads to the authenticated
 * Supabase client (every read runs under RLS, so a report belonging to
 * another company is simply invisible) and the writes to the service-role
 * client: deleting the exact report row the RLS-scoped read just proved
 * visible — the live database carries no DELETE RLS policy on
 * roof_report_orders (verified 2026-11-27: only the legacy SELECT policies
 * exist), so an authenticated row delete silently matches zero rows — plus
 * the post-authorization cleanup: removing the deleted report's own
 * drawing revisions, nulling their drawing_id references, and deleting
 * the exact storage files those records pointed to. Tenant isolation
 * comes from the membership/role gate and the RLS-scoped proof reads, not
 * from the delete itself. No company id is ever taken from request data.
 */
export interface RoofReportDeleteDeps {
  /** The caller's single company membership, or null when they have none. */
  getMembership(userId: string): Promise<{ company_id: string; role: string } | null>;
  /** RLS-scoped read: null when the report is missing or another tenant's. */
  getReport(reportId: string): Promise<{ id: string; file_path: string | null } | null>;
  /** RLS-scoped read of the drawing revisions saved against the report. */
  listReportDrawings(
    reportId: string,
  ): Promise<Array<{ id: string; parent_id: string | null; media: unknown }>>;
  /**
   * Service-role delete of the exact report row whose visibility was just
   * proven by getReport under RLS; false when no row was deleted.
   */
  deleteReportRow(reportId: string): Promise<boolean>;
  /** Service-role listing of the report's private PDF folder; null on error. */
  listReportPdfPaths(reportId: string): Promise<string[] | null>;
  /** Service-role storage removal; false on error. */
  removeStorageFiles(bucket: string, paths: string[]): Promise<boolean>;
  /** Service-role: null drawing_id on estimates/jobs/proposals that referenced the drawings; false on error. */
  clearDrawingReferences(drawingIds: string[]): Promise<boolean>;
  /** Service-role row delete for drawing revisions; false on error. */
  deleteDrawingRows(drawingIds: string[]): Promise<boolean>;
  /** Service-role check whether any surviving drawing still references a media path. */
  mediaStillReferenced(path: string): Promise<boolean>;
}

/** Roles allowed to delete roof reports (mirrors the RLS delete policy). */
export const ROOF_REPORT_DELETE_ROLES = [
  "owner",
  "admin",
  "office",
  "sales",
  "production_manager",
] as const;

const REPORT_PDF_PATTERN = /^roof-report\/[a-f0-9-]+\/[a-f0-9-]+\.pdf$/;

/** Extract validated storage paths from a drawing's persisted media column. */
export function collectDrawingMediaPaths(media: unknown): string[] {
  if (!Array.isArray(media)) return [];
  const paths: string[] = [];
  for (const item of media) {
    if (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as { path?: unknown }).path === "string" &&
      isSafeRoofMediaPath((item as { path: string }).path)
    ) {
      paths.push((item as { path: string }).path);
    }
  }
  return [...new Set(paths)];
}

/**
 * Group drawing revisions into deletion batches that respect the
 * parent_id revision chain: a revision can only be deleted once every
 * revision in the set that points at it as its parent is gone. Rows left
 * over after batching form a cycle and are reported as undeletable.
 */
export function deletionBatches(drawings: Array<{ id: string; parent_id: string | null }>): {
  batches: string[][];
  leftover: string[];
} {
  const remaining = new Map(drawings.map((d) => [d.id, d.parent_id]));
  const batches: string[][] = [];
  while (remaining.size) {
    const referencedAsParent = new Set(
      [...remaining.values()].filter(
        (parentId): parentId is string => parentId !== null && remaining.has(parentId),
      ),
    );
    const batch = [...remaining.keys()].filter((id) => !referencedAsParent.has(id));
    if (!batch.length) break;
    batches.push(batch);
    for (const id of batch) remaining.delete(id);
  }
  return { batches, leftover: [...remaining.keys()] };
}

export interface RoofReportDeleteResult {
  id: string;
  drawingsDeleted: number;
  fileCleanupPending: boolean;
  drawingsCleanupPending: boolean;
}

export async function deleteRoofReportCascade(
  deps: RoofReportDeleteDeps,
  input: { userId: string; reportId: string },
): Promise<RoofReportDeleteResult> {
  const membership = await deps.getMembership(input.userId);
  if (!membership) throw new Error("A single company membership is required");
  if (!(ROOF_REPORT_DELETE_ROLES as readonly string[]).includes(membership.role))
    throw new Error("You do not have access to delete roof reports");

  // RLS-scoped: another company's report is indistinguishable from a
  // missing one, so cross-tenant deletes stop here.
  const report = await deps.getReport(input.reportId);
  if (!report) throw new Error("Roof report was already deleted or does not exist");

  if (
    report.file_path &&
    (!report.file_path.startsWith(`roof-report/${input.reportId}/`) ||
      !REPORT_PDF_PATTERN.test(report.file_path))
  ) {
    throw new Error(
      "The report contains an unexpected file path. Contact an administrator before deleting it.",
    );
  }

  // Collect the drawing revisions before the report row is deleted: the
  // report_order_id link is set to NULL by the schema when the row goes.
  const drawings = await deps.listReportDrawings(input.reportId);
  const drawingIds = drawings.map((d) => d.id);
  const mediaPaths = [...new Set(drawings.flatMap((d) => collectDrawingMediaPaths(d.media)))];

  // Delete the database record first. Removing files first could destroy
  // the only report copy if the subsequent database delete failed.
  const deleted = await deps.deleteReportRow(input.reportId);
  if (!deleted)
    throw new Error("Could not delete the roof report. The report PDF was left untouched.");

  let fileCleanupPending = false;
  let drawingsCleanupPending = false;
  let drawingsDeleted = 0;

  // Every stored PDF for this report (the folder may hold regenerated
  // copies, not just the currently attached file_path).
  const listed = await deps.listReportPdfPaths(input.reportId);
  if (listed === null) fileCleanupPending = true;
  const pdfPaths = new Set(listed ?? []);
  if (report.file_path) pdfPaths.add(report.file_path);
  if (pdfPaths.size) {
    const removed = await deps.removeStorageFiles("roofing-proposals", [...pdfPaths]);
    if (!removed) fileCleanupPending = true;
  }

  if (drawingIds.length) {
    // Estimates, jobs and proposals reference drawings with plain foreign
    // keys; null the references first (the same SET NULL semantics the
    // schema already uses for report links) so revision rows can go.
    const cleared = await deps.clearDrawingReferences(drawingIds);
    if (!cleared) drawingsCleanupPending = true;

    const { batches, leftover } = deletionBatches(drawings);
    if (leftover.length) drawingsCleanupPending = true;
    for (const batch of batches) {
      const ok = await deps.deleteDrawingRows(batch);
      if (ok) drawingsDeleted += batch.length;
      else drawingsCleanupPending = true;
    }
  }

  // Drawing media files (aerials/photos in roof-job-photos) are removed
  // only when no surviving drawing — e.g. another revision kept on the
  // same property — still references them.
  for (const path of mediaPaths) {
    if (await deps.mediaStillReferenced(path)) continue;
    const removed = await deps.removeStorageFiles("roof-job-photos", [path]);
    if (!removed) fileCleanupPending = true;
  }

  return { id: input.reportId, drawingsDeleted, fileCleanupPending, drawingsCleanupPending };
}
