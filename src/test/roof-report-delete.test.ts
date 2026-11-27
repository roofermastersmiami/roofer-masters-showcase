import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectDrawingMediaPaths,
  deleteRoofReportCascade,
  deletionBatches,
  type RoofReportDeleteDeps,
} from "@/lib/roof-report-delete.server";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const PDF_NAME = "22222222-2222-4222-8222-222222222222.pdf";
const PDF_PATH = `roof-report/${REPORT_ID}/${PDF_NAME}`;
const REGENERATED_PDF_PATH = `roof-report/${REPORT_ID}/33333333-3333-4333-8333-333333333333.pdf`;
const SHARED_MEDIA = "drawing-prop-1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png";
const OWN_MEDIA = "drawing-prop-1/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png";

type DrawingRow = { id: string; parent_id: string | null; media: unknown };

function makeDeps(overrides: Partial<RoofReportDeleteDeps> = {}) {
  const calls = {
    deletedReportRows: [] as string[],
    clearedReferences: [] as string[][],
    deletedDrawingBatches: [] as string[][],
    removedFiles: [] as Array<{ bucket: string; paths: string[] }>,
  };
  const drawings: DrawingRow[] = [
    {
      id: "drawing-rev-1",
      parent_id: null,
      media: [
        { path: SHARED_MEDIA, name: "Aerial", category: "aerial" },
        { path: OWN_MEDIA, name: "Aerial 2", category: "aerial" },
      ],
    },
    { id: "drawing-rev-2", parent_id: "drawing-rev-1", media: [] },
  ];
  const deps: RoofReportDeleteDeps = {
    getMembership: async () => ({ company_id: "company-1", role: "owner" }),
    getReport: async () => ({ id: REPORT_ID, file_path: PDF_PATH }),
    listReportDrawings: async () => drawings,
    deleteReportRow: async (id) => {
      calls.deletedReportRows.push(id);
      return true;
    },
    listReportPdfPaths: async () => [PDF_PATH, REGENERATED_PDF_PATH],
    removeStorageFiles: async (bucket, paths) => {
      calls.removedFiles.push({ bucket, paths });
      return true;
    },
    clearDrawingReferences: async (ids) => {
      calls.clearedReferences.push(ids);
      return true;
    },
    deleteDrawingRows: async (ids) => {
      calls.deletedDrawingBatches.push(ids);
      return true;
    },
    // After this report's drawings are gone, only the shared aerial is
    // still referenced — by a surviving drawing on the same property.
    mediaStillReferenced: async (path) => path === SHARED_MEDIA,
    ...overrides,
  };
  return { deps, calls };
}

describe("deleteRoofReportCascade", () => {
  it("lets an owner delete their own report with its drawing revisions and files", async () => {
    const { deps, calls } = makeDeps();
    const result = await deleteRoofReportCascade(deps, {
      userId: "user-1",
      reportId: REPORT_ID,
    });

    expect(result).toEqual({
      id: REPORT_ID,
      drawingsDeleted: 2,
      fileCleanupPending: false,
      drawingsCleanupPending: false,
    });
    expect(calls.deletedReportRows).toEqual([REPORT_ID]);
    // Revision chain deleted children-first so the parent_id FK never blocks.
    expect(calls.deletedDrawingBatches).toEqual([["drawing-rev-2"], ["drawing-rev-1"]]);
    expect(calls.clearedReferences).toEqual([["drawing-rev-1", "drawing-rev-2"]]);
    // Every PDF stored for the report is removed, not just the attached one.
    expect(calls.removedFiles).toContainEqual({
      bucket: "roofing-proposals",
      paths: expect.arrayContaining([PDF_PATH, REGENERATED_PDF_PATH]),
    });
    // The drawing's own media file goes; the shared aerial stays.
    expect(calls.removedFiles).toContainEqual({ bucket: "roof-job-photos", paths: [OWN_MEDIA] });
    expect(calls.removedFiles.flatMap((c) => c.paths)).not.toContain(SHARED_MEDIA);
  });

  it("refuses another tenant's report: the RLS-scoped read finds nothing and nothing is deleted", async () => {
    const { deps, calls } = makeDeps({ getReport: async () => null });
    await expect(
      deleteRoofReportCascade(deps, { userId: "user-2", reportId: REPORT_ID }),
    ).rejects.toThrow("already deleted or does not exist");
    expect(calls.deletedReportRows).toEqual([]);
    expect(calls.deletedDrawingBatches).toEqual([]);
    expect(calls.clearedReferences).toEqual([]);
    expect(calls.removedFiles).toEqual([]);
  });

  it("refuses roles that may not delete roof reports", async () => {
    const { deps, calls } = makeDeps({
      getMembership: async () => ({ company_id: "company-1", role: "crew" }),
    });
    await expect(
      deleteRoofReportCascade(deps, { userId: "user-3", reportId: REPORT_ID }),
    ).rejects.toThrow("You do not have access to delete roof reports");
    expect(calls.deletedReportRows).toEqual([]);
    expect(calls.removedFiles).toEqual([]);
  });

  it("refuses callers without a company membership", async () => {
    const { deps } = makeDeps({ getMembership: async () => null });
    await expect(
      deleteRoofReportCascade(deps, { userId: "user-4", reportId: REPORT_ID }),
    ).rejects.toThrow("A single company membership is required");
  });

  it("stops before deleting anything when the stored PDF path is unexpected", async () => {
    const { deps, calls } = makeDeps({
      getReport: async () => ({ id: REPORT_ID, file_path: "someone-else/report.pdf" }),
    });
    await expect(
      deleteRoofReportCascade(deps, { userId: "user-1", reportId: REPORT_ID }),
    ).rejects.toThrow("unexpected file path");
    expect(calls.deletedReportRows).toEqual([]);
  });

  it("aborts with the PDF-untouched error and runs zero cleanup when the row delete matches no row", async () => {
    // This is the failure Fredy hit live: the proof reads succeed but the
    // row delete affects nothing. The cascade must stop before touching a
    // single file or drawing so nothing is half-deleted.
    const { deps, calls } = makeDeps({ deleteReportRow: async () => false });
    await expect(
      deleteRoofReportCascade(deps, { userId: "user-1", reportId: REPORT_ID }),
    ).rejects.toThrow("Could not delete the roof report. The report PDF was left untouched.");
    expect(calls.deletedDrawingBatches).toEqual([]);
    expect(calls.clearedReferences).toEqual([]);
    expect(calls.removedFiles).toEqual([]);
  });

  it("proves tenant visibility before the authorized row delete, then cleans up", async () => {
    // Regression pin for the live bug: the production database has no
    // DELETE RLS policy on roof_report_orders, so the row delete runs
    // through the authorized service-role dep — but only AFTER the
    // membership gate and the RLS-scoped reads have proven the report is
    // the caller's own. This order is what keeps another tenant's report
    // undeletable even though the delete itself bypasses RLS.
    const sequence: string[] = [];
    const { deps } = makeDeps({
      getMembership: async () => {
        sequence.push("membership");
        return { company_id: "company-1", role: "owner" };
      },
      getReport: async () => {
        sequence.push("proof-read");
        return { id: REPORT_ID, file_path: PDF_PATH };
      },
      listReportDrawings: async () => {
        sequence.push("collect-drawings");
        return [];
      },
      deleteReportRow: async () => {
        sequence.push("row-delete");
        return true;
      },
      listReportPdfPaths: async () => {
        sequence.push("cleanup");
        return [PDF_PATH];
      },
    });
    const result = await deleteRoofReportCascade(deps, {
      userId: "user-1",
      reportId: REPORT_ID,
    });
    expect(result.fileCleanupPending).toBe(false);
    expect(sequence).toEqual([
      "membership",
      "proof-read",
      "collect-drawings",
      "row-delete",
      "cleanup",
    ]);
  });

  it("reports pending cleanup instead of failing when storage removal fails", async () => {
    const { deps } = makeDeps({
      removeStorageFiles: async () => false,
      listReportPdfPaths: async () => null,
    });
    const result = await deleteRoofReportCascade(deps, {
      userId: "user-1",
      reportId: REPORT_ID,
    });
    expect(result.fileCleanupPending).toBe(true);
    expect(result.drawingsDeleted).toBe(2);
  });
});

describe("deletionBatches", () => {
  it("orders a three-revision chain children-first", () => {
    const { batches, leftover } = deletionBatches([
      { id: "a", parent_id: null },
      { id: "b", parent_id: "a" },
      { id: "c", parent_id: "b" },
    ]);
    expect(batches).toEqual([["c"], ["b"], ["a"]]);
    expect(leftover).toEqual([]);
  });

  it("reports a parent cycle as leftover instead of looping forever", () => {
    const { batches, leftover } = deletionBatches([
      { id: "a", parent_id: "b" },
      { id: "b", parent_id: "a" },
    ]);
    expect(batches).toEqual([]);
    expect(leftover.sort()).toEqual(["a", "b"]);
  });
});

describe("collectDrawingMediaPaths", () => {
  it("keeps only safe string paths and dedupes them", () => {
    expect(
      collectDrawingMediaPaths([
        { path: OWN_MEDIA },
        { path: OWN_MEDIA },
        { path: "../traversal.png" },
        { path: "/absolute.png" },
        { name: "no path" },
        "junk",
        null,
      ]),
    ).toEqual([OWN_MEDIA]);
    expect(collectDrawingMediaPaths("not-an-array")).toEqual([]);
  });
});

describe("delete affordances on the report surfaces", () => {
  const tab = readFileSync(
    resolve(process.cwd(), "src/components/dashboard/RoofMeasurementsTab.tsx"),
    "utf8",
  );
  const reports = readFileSync(
    resolve(process.cwd(), "src/components/dashboard/RoofReports.tsx"),
    "utf8",
  );

  it("offers the shared visible Delete action in the measurements list and workspace", () => {
    // One usage on each report card, one in the open workspace header.
    expect(tab.match(/<DeleteRoofReportButton/g)?.length).toBeGreaterThanOrEqual(2);
    expect(tab).toContain('from "./DeleteRoofReport"');
  });

  it("offers the shared visible Delete action on Roof reports cards, not only behind the swipe", () => {
    expect(reports.match(/<DeleteRoofReportButton/g)?.length).toBeGreaterThanOrEqual(2);
    expect(reports).toContain('from "./DeleteRoofReport"');
  });

  it("routes the shared button at the tenant-audited server function", () => {
    const button = readFileSync(
      resolve(process.cwd(), "src/components/dashboard/DeleteRoofReport.tsx"),
      "utf8",
    );
    expect(button).toContain("deleteRoofOrder");
    expect(button).toContain("its saved roof drawing");
  });

  it("deletes the proven report row through the service-role client, not the RLS client", () => {
    // The live database carries no DELETE RLS policy on roof_report_orders
    // (only the legacy SELECT policies), so an authenticated delete matches
    // zero rows and Fredy's delete failed with the PDF-untouched error.
    // The wiring must use supabaseAdmin for the row delete while the proof
    // reads stay on the authenticated client.
    const functions = readFileSync(
      resolve(process.cwd(), "src/lib/roof-orders.functions.ts"),
      "utf8",
    );
    const depStart = functions.indexOf("deleteReportRow: async");
    expect(depStart).toBeGreaterThan(-1);
    const depBlock = functions.slice(depStart, depStart + 900);
    expect(depBlock).toContain("supabaseAdmin");
    expect(depBlock).toContain('from("roof_report_orders")');
    expect(depBlock).not.toContain("await auth");
    // The proof read in the same handler stays RLS-scoped.
    const proofStart = functions.indexOf("getReport: async");
    const proofBlock = functions.slice(proofStart, proofStart + 400);
    expect(proofBlock).toContain("await auth");
    // The tenant-audit header documents the service-role row delete.
    expect(functions.slice(0, 1200)).toContain("tenant-audit: reviewed");
    expect(functions.slice(0, 1200)).toContain("no DELETE RLS policy");
  });
});
