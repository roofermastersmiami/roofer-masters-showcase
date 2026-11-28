import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Database } from "@/integrations/supabase/types";
import { saveRoofDrawing } from "@/lib/roof-drawing.functions";
import { restoreRoofDrawingMedia } from "@/lib/roof-drawing-media";
import { drawingSchema, type RoofDrawing } from "@/lib/roof-geometry";
import type { RoofOrder } from "./roof-orders-data";
import { SketchEditor } from "./SketchEditor";
import { requestReportPdfRefresh } from "./use-auto-finish";

type RoofDrawingRow = Database["public"]["Tables"]["roof_drawings"]["Row"];

/**
 * "Edit sketch" action for one measurement report, shown on the report
 * lists (the Roof measurements cards and the Roof reports rows) —
 * Fredy asked for it on the list rather than inside the workspace.
 * Opens the same sketch editor over the report's current drawing
 * revision; Done persists the edit through the exact save path the
 * workspace uses (saveRoofDrawing: a new immutable revision linked to
 * the previous one, marked unreviewed, with the report's measurements
 * updated server-side and the same toasts on blockers). Cancel just
 * closes. A report with no saved drawing has nothing to edit yet, so
 * the action is not rendered for it.
 *
 * Saving an edit updates everything downstream automatically, the
 * same way the workspace's save does: the query invalidations refresh
 * every surface's totals from the new revision, and when the report
 * already carries a PDF the save registers the PDF-refresh hand-off
 * (requestReportPdfRefresh) so the background engine — the one
 * finisher — regenerates the PDF from the edited drawing and
 * replaces the stored file. A manual edit also retires the detection
 * service's edge totals (service_edge_lengths_lf): they classified
 * the seams of the drawing as detected, so once a person changes the
 * geometry the edited drawing is the only truth, and the material
 * list and the report PDF derive their edge totals from it. The
 * override therefore survives only on drawings nobody has edited.
 */
export function EditSketchButton({
  report,
  drawingRow,
}: {
  report: RoofOrder;
  drawingRow: RoofDrawingRow | null;
}) {
  const save = useServerFn(saveRoofDrawing);
  const qc = useQueryClient();
  const [editorDrawing, setEditorDrawing] = useState<RoofDrawing | null>(null);
  const savingRef = useRef(false);

  if (!drawingRow) return null;
  const currentRow = drawingRow;

  function openEditor() {
    const stored = drawingSchema.safeParse(currentRow.geometry);
    if (!stored.success) {
      toast.error("Drawing data could not load");
      return;
    }
    setEditorDrawing(stored.data);
  }

  async function handleDone(next: RoofDrawing, changed: boolean) {
    if (!changed) {
      setEditorDrawing(null);
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      // A hand edit supersedes the detection service's edge totals:
      // drop them so the saved revision's measurements, material
      // list and regenerated PDF all derive from the edited
      // geometry. (Detached structures ride along unedited — the
      // editor only edits the main house — so their totals stay.)
      const { service_edge_lengths_lf: _serviceTotals, ...editedGeometry } = next;
      const row = await save({
        data: {
          property_id: report.property_id,
          title: report.title,
          geometry: { ...editedGeometry, verified: false },
          parent_id: currentRow.id,
          media: restoreRoofDrawingMedia(currentRow.media),
          report_order_id: report.id,
        },
      });
      toast.success(`Drawing revision ${row.revision} saved`);
      await qc.invalidateQueries({ queryKey: ["roof-drawings"] });
      await qc.invalidateQueries({ queryKey: ["roof-report-orders"] });
      // Hand the PDF step to the background engine (one finisher):
      // when this edit superseded a PDF already on file, the refresh
      // intent has the engine regenerate it from the edited drawing.
      // With no PDF on file yet, the normal auto-finish picks the
      // report up on its own — no second path is needed here.
      if (report.file_path && row.id) requestReportPdfRefresh(report.id, row.id);
      setEditorDrawing(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the edited drawing");
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <>
      <Button variant="outline" onClick={openEditor}>
        <Pencil /> Edit sketch
      </Button>
      {editorDrawing && (
        <SketchEditor
          drawing={editorDrawing}
          onCancel={() => setEditorDrawing(null)}
          onDone={(next, changed) => void handleDone(next, changed)}
        />
      )}
    </>
  );
}
