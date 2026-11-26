import { ClipboardCheck, FileCheck2, FolderOpen, MapPinned, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const setupAreas = [
  {
    title: "Permit pipeline",
    description:
      "Track permit applications from draft through approval, inspections, and closeout. Records will be linked to the CRM customer, property, job, and roof report.",
    icon: ClipboardCheck,
  },
  {
    title: "HVHZ packet builder",
    description:
      "Prepare jurisdiction-specific roof submittals, attach reviewed roof drawings, and assemble verified product approvals and supporting PDFs.",
    icon: FileCheck2,
  },
  {
    title: "Jurisdictions & product approvals",
    description:
      "Maintain official building department links, local NOC thresholds, approved NOAs and Florida Product Approval references, and uploaded permit templates.",
    icon: MapPinned,
  },
];

export function Permitting() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sales & production
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Permitting</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Manage roofing permits and HVHZ submittal preparation in the same company workspace as
            your leads, properties, roof measurements, and projects.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <ShieldAlert className="size-3.5" />
          Setup required
        </Badge>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="text-base">Permit records are not connected yet</CardTitle>
          <CardDescription className="max-w-3xl leading-relaxed">
            This workspace is now part of the existing CRM navigation. It will not display sample
            permits or claim that packets have been submitted. The permit tables, company-scoped
            access policies, and private document storage must be provisioned before records can be
            created or saved.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {setupAreas.map(({ title, description, icon: Icon }) => (
          <Card key={title} className="h-full">
            <CardHeader className="space-y-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="leading-relaxed">{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Required before live permitting can be enabled</CardTitle>
          <CardDescription>
            These controls protect customer data and prevent inaccurate permit submissions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
            <li className="flex gap-2">
              <FolderOpen className="mt-0.5 size-4 shrink-0 text-primary" />
              Tenant-isolated permit records and private packet storage.
            </li>
            <li className="flex gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-primary" />
              Role-checked access and idempotent permit creation from approved work.
            </li>
            <li className="flex gap-2">
              <FileCheck2 className="mt-0.5 size-4 shrink-0 text-primary" />
              Verified NOA / FL approval records and real jurisdiction templates.
            </li>
            <li className="flex gap-2">
              <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              Packet generation, upload confirmation, and inspection status history.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
