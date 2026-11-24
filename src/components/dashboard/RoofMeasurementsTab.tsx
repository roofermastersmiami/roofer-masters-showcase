import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, MapPin, Plus, Ruler } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createRoofOrder } from "@/lib/roof-orders.functions";
import { lookupRoofAddress } from "@/lib/roof-address.functions";
import { roofOrderSchema } from "@/lib/roof-order-schema";
import { customersQuery } from "./foundation-data";
import { drawingsQuery } from "./roof-data";
import { roofOrdersQuery } from "./roof-orders-data";
import { RoofMeasurements } from "./RoofMeasurements";
import { Empty, Field, SectionHeading } from "./CrmControls";

type LocatedAddress = { matchedAddress: string; lat: number; lon: number };

export function RoofMeasurementsTab({
  selectedReportId,
  onSelectReport,
  initialCustomer,
  initialPropertyId,
  initialAddress = "",
  onRequestHandled,
}: {
  selectedReportId: string | null;
  onSelectReport: (reportId: string | null) => void;
  initialCustomer?: string;
  initialPropertyId?: string;
  initialAddress?: string;
  onRequestHandled: () => void;
}) {
  const orders = useQuery(roofOrdersQuery);
  const drawings = useQuery(drawingsQuery);
  const customers = useQuery(customersQuery);
  const qc = useQueryClient();
  const create = useServerFn(createRoofOrder);
  const lookup = useServerFn(lookupRoofAddress);
  const [activeId, setActiveId] = useState<string | null>(selectedReportId);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [locatedAddress, setLocatedAddress] = useState<LocatedAddress | null>(null);
  const [originalCrmAddress, setOriginalCrmAddress] = useState(initialAddress);
  const [addressError, setAddressError] = useState("");
  const [form, setForm] = useState({
    address: initialAddress,
    title: "Roof measurement report",
    provider: "manual" as const,
    notes: "",
  });
  const initialRequestHandled = useRef<string | null>(null);

  useEffect(() => {
    setActiveId(selectedReportId);
  }, [selectedReportId]);

  useEffect(() => {
    if (!initialAddress) {
      initialRequestHandled.current = null;
      return;
    }
    if (orders.isPending || initialRequestHandled.current === initialAddress) return;
    initialRequestHandled.current = initialAddress;
    const existing = orders.data?.find((item) =>
      initialPropertyId
        ? item.property_id === initialPropertyId
        : item.address.trim().toLowerCase() === initialAddress.trim().toLowerCase(),
    );
    if (existing) {
      setActiveId(existing.id);
      onSelectReport(existing.id);
      onRequestHandled();
      return;
    }
    setForm((current) => ({ ...current, address: initialAddress }));
    setOriginalCrmAddress(initialAddress);
    setAdding(true);
    onRequestHandled();
  }, [
    initialAddress,
    initialPropertyId,
    orders.data,
    orders.isPending,
    onSelectReport,
    onRequestHandled,
  ]);

  const report = orders.data?.find((item) => item.id === activeId);
  const drawing = report
    ? (drawings.data?.find((item) => item.id === report.drawing_id) ?? null)
    : null;

  async function locateAddress() {
    const address = form.address.trim();
    if (address.length < 8) {
      setAddressError("Enter the complete street address, city, state and ZIP code.");
      return;
    }
    setLookupBusy(true);
    setAddressError("");
    setLocatedAddress(null);
    try {
      const result = await lookup({ data: { address } });
      if ("error" in result) {
        setAddressError(result.error);
        return;
      }
      setLocatedAddress(result);
      setForm((current) => ({ ...current, address: result.matchedAddress }));
      toast.success("Property address located");
    } catch (error) {
      setAddressError(
        error instanceof Error ? error.message : "Address lookup could not complete.",
      );
    } finally {
      setLookupBusy(false);
    }
  }

  async function createReport() {
    if (!locatedAddress || form.address.trim() !== locatedAddress.matchedAddress) {
      toast.error("Locate and confirm the property address before creating the report");
      return;
    }
    const parsed = roofOrderSchema.safeParse({
      ...form,
      // Preserve the exact saved CRM address so the server reuses its property record.
      address: originalCrmAddress || locatedAddress.matchedAddress,
    });
    if (!parsed.success) {
      toast.error("Enter the complete property address");
      return;
    }
    setBusy(true);
    try {
      const created = await create({ data: parsed.data });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["roof-report-orders"] }),
        qc.invalidateQueries({ queryKey: ["crm-properties"] }),
      ]);
      setAdding(false);
      setActiveId(created.id);
      onSelectReport(created.id);
      toast.success("Property report created. Continue with roof measurements.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create roof report");
    } finally {
      setBusy(false);
    }
  }

  if (activeId && report) {
    return (
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Roof measurements · Linked report
            </p>
            <h1 className="mt-1 break-words text-lg font-bold">{report.address}</h1>
            <p className="text-sm text-muted-foreground">
              {customers.data?.find((customer) => customer.id === report.customer_id)?.name ??
                "Customer property"}
              {" · "}
              {report.title}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setActiveId(null);
                onSelectReport(null);
                setForm({
                  address: "",
                  title: "Roof measurement report",
                  provider: "manual",
                  notes: "",
                });
                setOriginalCrmAddress("");
                setLocatedAddress(null);
                setAddressError("");
                setAdding(true);
              }}
            >
              <Plus /> Create report by address
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setActiveId(null);
                onSelectReport(null);
              }}
            >
              <ArrowLeft /> All measurements
            </Button>
          </div>
        </div>
        {drawings.isPending ? (
          <p>Loading saved roof drawing…</p>
        ) : drawings.error ? (
          <p role="alert" className="text-destructive">
            Saved measurements could not load. Refresh before editing.
          </p>
        ) : (
          <RoofMeasurements key={report.id} report={report} initialDrawing={drawing} />
        )}
      </div>
    );
  }

  if (activeId && orders.isPending) {
    return <p className="py-12 text-center text-muted-foreground">Loading linked roof report…</p>;
  }

  if (activeId && !report) {
    return (
      <div className="grid gap-4">
        <p role="alert" className="text-destructive">
          This roof report could not be found. Return to Roof reports and select it again.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setActiveId(null);
            onSelectReport(null);
          }}
        >
          <ArrowLeft /> All measurements
        </Button>
      </div>
    );
  }

  const rows = orders.data ?? [];
  return (
    <div>
      <SectionHeading
        title="Roof measurements"
        action={
          <Button
            onClick={() => {
              setForm({
                address: "",
                title: "Roof measurement report",
                provider: "manual",
                notes: "",
              });
              setOriginalCrmAddress("");
              setLocatedAddress(null);
              setAddressError("");
              setAdding(true);
            }}
          >
            <Plus /> Create report by address
          </Button>
        }
      />
      <p className="mb-5 text-sm text-muted-foreground">
        Start with a property address, then trace or enter roof dimensions in the linked 2D and 3D
        workspace. The completed measurement PDF is saved back to Roof reports.
      </p>
      {orders.error || drawings.error ? (
        <p role="alert" className="mb-4 text-destructive">
          Roof measurement records could not load.
        </p>
      ) : orders.isPending || drawings.isPending ? (
        <p>Loading roof measurement records…</p>
      ) : rows.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const customer = customers.data?.find((item) => item.id === row.customer_id);
            const savedDrawing = drawings.data?.find((item) => item.id === row.drawing_id);
            return (
              <article
                key={row.id}
                className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5"
              >
                <div className="flex items-center gap-2 text-primary">
                  <Ruler className="size-5" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    Measurement workspace
                  </span>
                </div>
                <h2 className="mt-3 break-words font-bold">{row.address}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {customer?.name ?? "Customer property"}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {savedDrawing ? "Saved drawing available" : "No drawing saved yet"} ·{" "}
                  {row.file_path ? "PDF generated" : "PDF not generated"}
                </p>
                <Button
                  className="mt-5"
                  variant="outline"
                  onClick={() => {
                    setActiveId(row.id);
                    onSelectReport(row.id);
                  }}
                >
                  <MapPin /> Open 2D / 3D workspace
                </Button>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty>No roof measurement reports yet. Create one by entering the property address.</Empty>
      )}
      <Dialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (!open) {
            setLocatedAddress(null);
            setAddressError("");
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create roof report by address</DialogTitle>
            <DialogDescription>
              {initialCustomer
                ? `Starting from ${customers.data?.find((customer) => customer.id === initialCustomer)?.name ?? "the selected customer"}’s saved property. `
                : ""}
              Locate the complete property address before opening its roof measurement workspace.
              Address lookup places the map pin; roof dimensions still require tracing or field
              measurement.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createReport();
            }}
          >
            <Field label="Customer property address">
              <Input
                required
                minLength={8}
                maxLength={250}
                autoComplete="street-address"
                placeholder="123 Main Street, Miami, FL 33130"
                value={form.address}
                onChange={(event) => {
                  setForm({ ...form, address: event.target.value });
                  setOriginalCrmAddress("");
                  setLocatedAddress(null);
                  setAddressError("");
                }}
              />
            </Field>
            <Button
              type="button"
              variant="outline"
              disabled={lookupBusy || form.address.trim().length < 8}
              onClick={() => void locateAddress()}
            >
              <MapPin /> {lookupBusy ? "Locating property…" : "Locate exact address"}
            </Button>
            {addressError && (
              <p role="alert" className="text-sm text-destructive">
                {addressError}
              </p>
            )}
            {locatedAddress && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-semibold">Address matched</p>
                <p className="mt-1">{locatedAddress.matchedAddress}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Coordinates: {locatedAddress.lat.toFixed(6)}, {locatedAddress.lon.toFixed(6)}
                </p>
              </div>
            )}
            <Field label="Report title">
              <Input
                required
                maxLength={180}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </Field>
            <Field label="Inspection notes">
              <Textarea
                value={form.notes}
                maxLength={4000}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
            <Button
              disabled={
                busy ||
                lookupBusy ||
                !locatedAddress ||
                form.address.trim() !== locatedAddress.matchedAddress
              }
              type="submit"
            >
              <Plus /> {busy ? "Creating…" : "Create and measure roof"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
