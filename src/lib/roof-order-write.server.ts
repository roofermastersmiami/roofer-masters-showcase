/**
 * Guarded write of a finished report PDF onto its roof report
 * order — the attach step of the automatic measurement finish.
 *
 * Why the write runs on the service-role client: the caller-facing
 * server function wires every authorization read to the
 * authenticated Supabase client (the membership, and the
 * RLS-scoped proof read of the exact report being attached — a
 * report belonging to another company is simply invisible there),
 * and only the final row update to the service-role client. The
 * live database carries NO UPDATE policy on roof_report_orders
 * for the authenticated role (verified 2026-11-27: only the two
 * legacy SELECT policies from migrations 0019/0024 exist; the
 * UPDATE policy lives in migration 0054, which the live database
 * has not applied — the same drift the PR #231 delete fix routed
 * around). Under PostgREST + RLS an UPDATE with no UPDATE policy
 * matches zero rows and returns no error, so an authenticated
 * attach silently never landed and was reported as a stale-version
 * rejection — every drawing-saved report failed its automatic
 * finish on every page load, with no rival writer involved.
 * Tenant isolation comes from the membership/role gate and the
 * RLS-scoped proof read, not from the write itself; no company id
 * is ever taken from request data.
 *
 * The version guard is unchanged and now honest: the caller's
 * expected updated_at must match the proof read, and the
 * service-role update re-checks the same version in its WHERE
 * clause, so a write that lands between the proof read and the
 * update still fails the guard and surfaces as the same
 * stale-version error the finish engine reconciles against fresh
 * reads.
 */
export interface RoofOrderAttachDeps {
  /** The caller's single company membership, or null when they have none. */
  getMembership(userId: string): Promise<{ company_id: string; role: string } | null>;
  /** Whether the uploaded PDF file exists in the report's storage folder. */
  reportPdfExists(reportId: string, fileName: string): Promise<boolean>;
  /**
   * RLS-scoped read of the report being attached: null when the
   * report is missing or another tenant's.
   */
  getReport(
    reportId: string,
  ): Promise<{ updated_at: string; status: string; file_path: string | null } | null>;
  /**
   * Service-role update of the exact report row the proof read just
   * verified, guarded by the expected updated_at version and
   * status <> cancelled; true when the row was written.
   */
  writeAttachedPdf(input: {
    id: string;
    path: string;
    expectedUpdatedAt: string;
  }): Promise<boolean>;
}

/** Roles allowed to attach report PDFs (mirrors the membership gate
 * the server function has always enforced). */
export const ROOF_ORDER_ATTACH_ROLES = [
  "owner",
  "admin",
  "office",
  "sales",
  "production_manager",
] as const;

/** The stale-version rejection, kept byte-identical: the finish
 * engine recognizes it and reconciles against fresh reads. */
export const STALE_ATTACH_ERROR = "Reload the report request before attaching this PDF";

const REPORT_PDF_PATH = /^roof-report\/[a-f0-9-]+\/[a-f0-9-]+\.pdf$/;

export async function attachRoofOrderPdfGuarded(
  deps: RoofOrderAttachDeps,
  input: { userId: string; id: string; path: string; updated_at: string },
): Promise<{ id: string }> {
  const membership = await deps.getMembership(input.userId);
  if (!membership) throw new Error("A single company membership is required");
  if (!(ROOF_ORDER_ATTACH_ROLES as readonly string[]).includes(membership.role))
    throw new Error("You do not have access to this action");

  if (!input.path.startsWith(`roof-report/${input.id}/`) || !REPORT_PDF_PATH.test(input.path))
    throw new Error("Invalid report file");

  const name = input.path.split("/").at(-1);
  if (!name || !(await deps.reportPdfExists(input.id, name)))
    throw new Error("Upload the report PDF first");

  // RLS-scoped proof read: another company's report is
  // indistinguishable from a missing one, and both surface as the
  // stale-version rejection (the outcome an unmatched guarded
  // update produced before), never as an existence leak.
  const report = await deps.getReport(input.id);
  if (!report) throw new Error(STALE_ATTACH_ERROR);
  if (report.status === "cancelled") throw new Error(STALE_ATTACH_ERROR);
  if (report.updated_at !== input.updated_at) throw new Error(STALE_ATTACH_ERROR);

  const written = await deps.writeAttachedPdf({
    id: input.id,
    path: input.path,
    expectedUpdatedAt: report.updated_at,
  });
  if (!written) throw new Error(STALE_ATTACH_ERROR);
  return { id: input.id };
}
