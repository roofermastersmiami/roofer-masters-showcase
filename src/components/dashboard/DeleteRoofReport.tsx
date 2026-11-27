import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteRoofOrder } from "@/lib/roof-orders.functions";

/**
 * Visible delete action for one roof report, with the confirmation dialog.
 * Shared by the Roof measurements list/workspace and the Roof reports list
 * so every surface deletes the same way: the report, its saved drawing
 * revisions and measurements, and its generated PDF are removed; the
 * customer and property records are kept.
 */
export function DeleteRoofReportButton({
  reportId,
  address,
  onDeleted,
  iconOnly = false,
}: {
  reportId: string;
  address: string;
  onDeleted?: () => void;
  iconOnly?: boolean;
}) {
  const qc = useQueryClient();
  const remove = useServerFn(deleteRoofOrder);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    try {
      const result = await remove({ data: { id: reportId } });
      await qc.invalidateQueries({ queryKey: ["roof-report-orders"] });
      await qc.invalidateQueries({ queryKey: ["roof-drawings"] });
      setConfirming(false);
      if (result.fileCleanupPending || result.drawingsCleanupPending) {
        toast.warning(
          "Roof report deleted, but some of its stored files could not be cleaned up. Ask an administrator to review storage.",
        );
      } else {
        toast.success("Roof report deleted — its drawings and PDF were removed too.");
      }
      onDeleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete roof report");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {iconOnly ? (
        <Button
          variant="destructive"
          size="icon"
          aria-label={`Delete roof report for ${address}`}
          title="Delete roof report"
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
        </Button>
      ) : (
        <Button
          variant="outline"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 /> Delete
        </Button>
      )}
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirming(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this roof report?</DialogTitle>
            <DialogDescription>
              This permanently removes the report for {address}, its saved roof drawing revisions
              and measurements, and its generated PDF. The customer and property records are kept.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={deleting} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>
              <Trash2 /> {deleting ? "Deleting…" : "Delete report"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
