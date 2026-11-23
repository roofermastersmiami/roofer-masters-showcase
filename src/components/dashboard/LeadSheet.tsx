import { useEffect, useState } from "react";
import { FileText, Mail, MessageSquare, Phone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PIPELINE_STAGES, PIPELINE_LABELS, stageOf } from "@/lib/crm-foundation";
import { useMoveStage } from "./foundation-data";
import { CustomerActivity } from "./CustomerActivity";
import { WhatsAppIcon } from "@/components/site/SocialIcons";
import { formatWhen, useDeleteLead, useUpdateLead, type Lead } from "./data";
import { SourceBadge, StatusBadge } from "./StatusBadge";
import { instantInputSchema, qualifyRoofLead } from "@/lib/instant-estimate-schema";
import { ClientPortalShare } from "./ClientPortalShare";

function waLink(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = "1" + digits;
  return `https://wa.me/${digits}`;
}

export function LeadSheet({
  lead,
  onClose,
  onOpenChat,
  onOpenProposals,
}: {
  lead: Lead | null;
  onClose: () => void;
  onOpenChat?: (id: string) => void;
  onOpenProposals?: (id: string) => void;
}) {
  const update = useUpdateLead();
  const move = useMoveStage();
  const del = useDeleteLead();
  const [notes, setNotes] = useState("");
  const qualification = instantInputSchema.safeParse(lead?.qualification);

  useEffect(() => setNotes(lead?.notes ?? ""), [lead?.id, lead?.notes]);

  return (
    <Sheet open={!!lead} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {lead && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display text-2xl font-black">{lead.name}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2">
                <StatusBadge status={lead.status} /> <SourceBadge source={lead.source} />
                <span className="text-xs">{formatWhen(lead.created_at)}</span>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 grid grid-cols-3 gap-2">
              {lead.phone && (
                <Button asChild variant="call" className="h-12 rounded-xl">
                  <a href={`tel:${lead.phone}`}>
                    <Phone /> Call
                  </a>
                </Button>
              )}
              {lead.phone && (
                <Button asChild variant="whatsapp" className="h-12 rounded-xl">
                  <a href={waLink(lead.phone)} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon /> WhatsApp
                  </a>
                </Button>
              )}
              {lead.email && (
                <Button asChild variant="outline" className="h-12 rounded-xl">
                  <a href={`mailto:${lead.email}`}>
                    <Mail /> Email
                  </a>
                </Button>
              )}
            </div>

            <dl className="mt-6 grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
              <Row label="Phone" value={lead.phone} />
              <Row label="Email" value={lead.email} />
              <Row label="Address" value={lead.address} />
              <Row label="Service" value={lead.service} />
              <Row label="From page" value={lead.page} />
              {qualification.success && (
                <>
                  <Row
                    label="Qualification"
                    value={qualifyRoofLead(qualification.data).replaceAll("_", " ")}
                  />
                  <Row label="Roof area" value={`${qualification.data.sqft} sq ft`} />
                  <Row label="Timeline" value={qualification.data.timeline} />
                  <Row
                    label="Language"
                    value={qualification.data.language === "es" ? "Spanish" : "English"}
                  />
                </>
              )}
              <div>
                <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Message
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-foreground">{lead.message || "—"}</dd>
              </div>
            </dl>

            {lead.source === "chat" && onOpenChat && (
              <Button variant="outline" className="mt-4 w-full" onClick={() => onOpenChat(lead.id)}>
                <MessageSquare /> Open chat conversation
              </Button>
            )}
            {onOpenProposals && (
              <Button
                variant="navy"
                className="mt-4 w-full"
                onClick={() => onOpenProposals(lead.id)}
              >
                <FileText /> Roofing proposals
              </Button>
            )}

            <ClientPortalShare leadId={lead.id} email={lead.email} />

            <div className="mt-6 grid gap-2">
              <label className="text-sm font-bold text-foreground">Pipeline stage</label>
              <Select
                value={stageOf(lead)}
                onValueChange={(v) => {
                  const stage = PIPELINE_STAGES.find((s) => s === v);
                  if (stage)
                    move.mutate(
                      { id: lead.id, stage },
                      { onSuccess: () => toast.success(`Sales stage: ${PIPELINE_LABELS[stage]}`) },
                    );
                }}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PIPELINE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-6 grid gap-2">
              <label htmlFor="lead-notes" className="text-sm font-bold text-foreground">
                Private notes
              </label>
              <Textarea
                id="lead-notes"
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Estimate amount, roof details, follow-up date…"
              />
              <Button
                variant="navy"
                disabled={notes === (lead.notes ?? "") || update.isPending}
                onClick={() =>
                  update.mutate(
                    { id: lead.id, notes },
                    { onSuccess: () => toast.success("Notes saved") },
                  )
                }
              >
                Save notes
              </Button>
            </div>

            <CustomerActivity leadId={lead.id} />

            <Button
              variant="ghost"
              className="mt-8 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                if (!confirm(`Delete lead from ${lead.name}? This can't be undone.`)) return;
                del.mutate(lead.id, {
                  onSuccess: () => {
                    toast.success("Lead deleted");
                    onClose();
                  },
                });
              }}
            >
              <Trash2 /> Delete lead
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value || "—"}</dd>
    </div>
  );
}
