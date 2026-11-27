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
import {
  SATELLITE_DEFAULT_ZOOM,
  SATELLITE_MAX_ZOOM,
  SATELLITE_MIN_ZOOM,
} from "@/lib/satellite-map";
import { SatelliteMap } from "./SatelliteMap";
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
  const [mapZoom, setMapZoom] = useState(SATELLITE_DEFAULT_ZOOM);
  const [locatedAddress, setLocatedAddress] = useState<LocatedAddress | null>(null);
  const [originalCrmAddress, setOriginalCrmAddress] = useState(initialAddress);
  const [addressError, setAddressError] = useState("");
  const [form, setForm] = useState({
    address: initialAddress,
    title: "",
    customer_phone: "",
    customer_email: "",
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
      setMapZoom(SATELLITE_DEFAULT_ZOOM);
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
      // Client name is optional in the form: the report is titled by
      // its address until a client is linked.
      title: form.title.trim() || locatedAddress.matchedAddress,
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
                  title: "",
                  customer_phone: "",
                  customer_email: "",
                  provider: "manual",
                  notes: "",
                });
                setOriginalCrmAddress("");
                setLocatedAddress(null);
                setMapZoom(SATELLITE_DEFAULT_ZOOM);
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
                title: "",
                customer_phone: "",
                customer_email: "",
                provider: "manual",
                notes: "",
              });
              setOriginalCrmAddress("");
              setLocatedAddress(null);
              setMapZoom(SATELLITE_DEFAULT_ZOOM);
              setAddressError("");
              setAdding(true);
            }}
          >
            <Plus /> Create report by address
          </Button>
        }
      />
      <p className="mb-5 text-sm text-muted-foreground">
        Start with a property address: the linked workspace measures the roof automatically from
        public LiDAR data, saves the measurement PDF back to Roof reports, and builds the material
        list. Tracing and manual dimensions remain available whenever you want them.
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
        <DialogContent className="max-h-[94dvh] w-[min(96vw,980px)] max-w-[980px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create roof report by address</DialogTitle>
            <DialogDescription>
              {initialCustomer
                ? `Starting from ${customers.data?.find((customer) => customer.id === initialCustomer)?.name ?? "the selected customer"}’s saved property. `
                : ""}
              Search for an address and confirm the pin is on the correct building. For apartment
              complexes or condos, create a separate report for each building. The roof is then
              measured automatically from public LiDAR data, the report PDF is generated and saved,
              and a material list is built from the measurement — you can review or adjust every
              result afterwards.
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
            {locatedAddress ? (
              <section className="space-y-2" aria-label="Property satellite map">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">Confirm building location</h3>
                    <p className="text-xs text-muted-foreground">
                      Red pin marks the matched address · zoom or scroll to verify the correct
                      structure
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label="Zoom map in"
                      disabled={mapZoom >= SATELLITE_MAX_ZOOM}
                      onClick={() => setMapZoom((z) => Math.min(SATELLITE_MAX_ZOOM, z + 1))}
                    >
                      +
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      aria-label="Zoom map out"
                      disabled={mapZoom <= SATELLITE_MIN_ZOOM}
                      onClick={() => setMapZoom((z) => Math.max(SATELLITE_MIN_ZOOM, z - 1))}
                    >
                      −
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setMapZoom(SATELLITE_DEFAULT_ZOOM)}
                    >
                      Reset
                    </Button>
                  </div>
                </div>
                <div className="relative h-[min(58vh,520px)] min-h-[300px] overflow-hidden rounded-md border border-border bg-muted">
                  <SatelliteMap
                    latitude={locatedAddress.lat}
                    longitude={locatedAddress.lon}
                    zoom={mapZoom}
                    label={`Satellite map centered on ${locatedAddress.matchedAddress}`}
                    onZoomChange={setMapZoom}
                  />
                  <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full">
                    <MapPin className="h-10 w-10 fill-red-600 text-white drop-shadow-lg" />
                  </div>
                  <div className="absolute bottom-3 left-3 max-w-[85%] rounded bg-background/95 px-3 py-2 text-xs shadow">
                    <strong className="block">Address pin</strong>
                    {locatedAddress.matchedAddress}
                  </div>
                  <div className="absolute right-3 top-3 rounded bg-background/95 px-2 py-1 text-[11px] font-medium shadow">
                    Satellite imagery · Esri
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Coordinates: {locatedAddress.lat.toFixed(6)}, {locatedAddress.lon.toFixed(6)}. The
                  pin is the geocoded address point, not a roof outline or verified measurement.
                </p>
              </section>
            ) : (
              <div className="grid min-h-[230px] place-items-center rounded-md border border-dashed border-border bg-muted/40 p-6 text-center">
                <div className="max-w-sm">
                  <MapPin className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="font-semibold">Property map</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Search an address and select “Locate exact address” to load satellite imagery
                    and place the property pin.
                  </p>
                </div>
              </div>
            )}
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
            <Field label="Client name (optional)">
              <Input
                maxLength={180}
                placeholder="Leave blank to title the report by its address"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </Field>
            <Field label="Client phone number">
              <Input
                type="tel"
                autoComplete="tel"
                maxLength={30}
                placeholder="(305) 555-0123"
                value={form.customer_phone}
                onChange={(event) => setForm({ ...form, customer_phone: event.target.value })}
              />
            </Field>
            <Field label="Client email address">
              <Input
                type="email"
                autoComplete="email"
                maxLength={255}
                placeholder="client@example.com"
                value={form.customer_email}
                onChange={(event) => setForm({ ...form, customer_email: event.target.value })}
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
