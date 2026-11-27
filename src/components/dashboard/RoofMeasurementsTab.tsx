import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Building, Building2, Home, MapPin, Plus, Ruler } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAutoFinishReports } from "./use-auto-finish";
import { AutoFinishStatus } from "./AutoFinishStatus";
import { DeleteRoofReportButton } from "./DeleteRoofReport";
import { EditSketchButton } from "./EditSketchButton";
import {
  SATELLITE_DEFAULT_ZOOM,
  SATELLITE_MAX_ZOOM,
  SATELLITE_MIN_ZOOM,
  type LatLon,
} from "@/lib/satellite-map";
import { BUILDING_TYPES, composeRoofOrderNotes, type BuildingType } from "@/lib/roof-order-notes";
import { locateBuildingPin, roofDetectionApiBase } from "@/lib/roof-analysis";
import { SatelliteMap, type SatelliteMapPin } from "./SatelliteMap";
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
  const [mapCenter, setMapCenter] = useState<LatLon | null>(null);
  const [pins, setPins] = useState<LatLon[]>([]);
  // Pin 1's position when it came from the detection service's
  // footprint snap (the selected building's centroid) rather than
  // the raw geocoded point — used only to label the pin honestly.
  const [footprintPin, setFootprintPin] = useState<LatLon | null>(null);
  const [buildingType, setBuildingType] = useState<BuildingType>("single_family");
  const [includeOutbuilding, setIncludeOutbuilding] = useState(false);
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
    setLocatedAddress(null);
    setMapCenter(null);
    setPins([]);
    setFootprintPin(null);
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

  function openOrderDialog() {
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
    setMapCenter(null);
    setPins([]);
    setFootprintPin(null);
    setBuildingType("single_family");
    setIncludeOutbuilding(false);
    setMapZoom(SATELLITE_DEFAULT_ZOOM);
    setAddressError("");
    setAdding(true);
  }

  const report = orders.data?.find((item) => item.id === activeId);
  const drawing = report
    ? (drawings.data?.find((item) => item.id === report.drawing_id) ?? null)
    : null;
  // While the measurements grid is open, every still-awaiting report
  // finishes itself here too — the same hands-off chain the Roof
  // reports list runs — so a card never sits at "PDF not generated
  // yet" waiting for a click. While a workspace is open the finisher
  // hands over to it (enabled only on the grid), exactly like
  // leaving the reports list does.
  const autoFinish = useAutoFinishReports(
    orders.data,
    drawings.data,
    customers.data,
    activeId === null,
  );

  async function locateAddress() {
    const address = form.address.trim();
    if (address.length < 8) {
      setAddressError("Enter the complete street address, city, state and ZIP code.");
      return;
    }
    setLookupBusy(true);
    setAddressError("");
    setLocatedAddress(null);
    setPins([]);
    setFootprintPin(null);
    setMapCenter(null);
    try {
      const result = await lookup({ data: { address } });
      if ("error" in result) {
        setAddressError(result.error);
        return;
      }
      setLocatedAddress(result);
      setMapCenter({ lat: result.lat, lon: result.lon });
      // Pin 1 belongs on the house, not on the geocoded street
      // point: ask the detection service which footprint it would
      // select for this point and drop the pin on that building's
      // centroid — the same point that then steers the measurement.
      // When the service finds no footprint nearby (or cannot be
      // reached), the pin keeps the geocoded point exactly as
      // before and Fredy can drag it onto the right building.
      const snapped = await locateBuildingPin(
        roofDetectionApiBase(),
        { lat: result.lat, lon: result.lon },
        result.matchedAddress,
      );
      if (snapped) {
        setFootprintPin({ lat: snapped.lat, lon: snapped.lon });
        setPins([{ lat: snapped.lat, lon: snapped.lon }]);
      } else {
        setPins([{ lat: result.lat, lon: result.lon }]);
      }
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

  const MAX_PINS = 6;
  const mapPins: SatelliteMapPin[] = pins.map((pin, index) => ({
    id: index,
    lat: pin.lat,
    lon: pin.lon,
  }));

  function movePin(id: number, point: LatLon) {
    setPins((current) => current.map((pin, index) => (index === id ? point : pin)));
  }

  function addPin(point: LatLon) {
    if (pins.length >= MAX_PINS) {
      toast.error(`Up to ${MAX_PINS} buildings per order — double-click a pin to remove one first`);
      return;
    }
    setPins((current) => [...current, point]);
  }

  function removePin(id: number) {
    setPins((current) => current.filter((_, index) => index !== id));
  }

  async function createReport() {
    if (!locatedAddress || form.address.trim() !== locatedAddress.matchedAddress) {
      toast.error("Locate and confirm the property address before creating the report");
      return;
    }
    if (pins.length === 0) {
      toast.error("Click the map to drop a pin on at least one building first");
      return;
    }
    // Client name is optional in the form: the report is titled by
    // its address until a client is linked.
    const baseTitle = form.title.trim() || locatedAddress.matchedAddress;
    setBusy(true);
    const createdIds: string[] = [];
    try {
      // One report per pin, same address: each report's workspace
      // measures its own building hands-off, steered by the pin
      // recorded in its notes.
      for (let index = 0; index < pins.length; index++) {
        const parsed = roofOrderSchema.safeParse({
          ...form,
          title: pins.length > 1 ? `${baseTitle.slice(0, 165)} · Building ${index + 1}` : baseTitle,
          // Preserve the exact saved CRM address so the server reuses its property record.
          address: originalCrmAddress || locatedAddress.matchedAddress,
          notes: composeRoofOrderNotes({
            buildingType,
            includeOutbuilding,
            pin: pins[index]!,
            notes: form.notes,
          }),
        });
        if (!parsed.success) {
          toast.error("Enter the complete property address");
          return;
        }
        const created = await create({ data: parsed.data });
        createdIds.push(created.id);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["roof-report-orders"] }),
        qc.invalidateQueries({ queryKey: ["crm-properties"] }),
      ]);
      setAdding(false);
      const first = createdIds[0];
      if (first) {
        setActiveId(first);
        onSelectReport(first);
      }
      toast.success(
        createdIds.length > 1
          ? `${createdIds.length} building reports created. Building 1 is open and measuring automatically; each other report also finishes automatically in Roof reports — no need to open it.`
          : "Property report created. Continue with roof measurements.",
      );
    } catch (error) {
      if (createdIds.length > 0) {
        // Keep the reports that did get created — they are saved and
        // measurable — and say plainly that the rest did not happen.
        await qc.invalidateQueries({ queryKey: ["roof-report-orders"] });
        setAdding(false);
        setActiveId(createdIds[0]!);
        onSelectReport(createdIds[0]!);
        toast.error(
          `Created ${createdIds.length} of ${pins.length} reports before an error stopped the rest. The created reports are saved.`,
        );
      } else {
        toast.error(error instanceof Error ? error.message : "Could not create roof report");
      }
    } finally {
      setBusy(false);
    }
  }

  if (activeId && report) {
    // The workspace header below shows the address exactly once, so
    // this page header never prints it (or a title that is the
    // address) again: it heads with the customer when known, else a
    // plain label or a client-given title.
    const headerCustomerName = customers.data?.find(
      (customer) => customer.id === report.customer_id,
    )?.name;
    const titleCarriesAddress =
      report.address.trim() !== "" &&
      report.title.trim().toLowerCase().includes(report.address.trim().toLowerCase());
    const workspaceHeading =
      headerCustomerName ?? (titleCarriesAddress ? "Roof measurement report" : report.title);
    return (
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Roof measurements · Linked report
            </p>
            <h1 className="mt-1 break-words text-lg font-bold">{workspaceHeading}</h1>
            {headerCustomerName && !titleCarriesAddress && report.title !== headerCustomerName && (
              <p className="text-sm text-muted-foreground">{report.title}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setActiveId(null);
                onSelectReport(null);
                openOrderDialog();
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
            <DeleteRoofReportButton
              reportId={report.id}
              address={report.address}
              onDeleted={() => {
                setActiveId(null);
                onSelectReport(null);
              }}
            />
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
          <Button onClick={openOrderDialog}>
            <Plus /> Create report by address
          </Button>
        }
      />
      <p className="mb-5 text-sm text-muted-foreground">
        Start with a property address: the linked workspace measures the roof automatically from
        public LiDAR data, saves the measurement PDF back to Roof reports, and builds the material
        list.
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
            const autoState = autoFinish.get(row.id);
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
                {autoState ? (
                  <AutoFinishStatus
                    state={autoState}
                    date={new Date(row.created_at).toLocaleDateString()}
                  />
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {savedDrawing ? "Saved drawing available" : "No drawing saved yet"} ·{" "}
                    {row.file_path ? "PDF generated" : "PDF not generated"}
                  </p>
                )}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setActiveId(row.id);
                      onSelectReport(row.id);
                    }}
                  >
                    <MapPin /> Open 2D / 3D workspace
                  </Button>
                  <EditSketchButton report={row} drawingRow={savedDrawing ?? null} />
                  <DeleteRoofReportButton reportId={row.id} address={row.address} />
                </div>
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
            setMapCenter(null);
            setPins([]);
            setFootprintPin(null);
            setAddressError("");
          }
        }}
      >
        <DialogContent className="max-h-[94dvh] w-[min(96vw,980px)] max-w-[980px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New measurement order</DialogTitle>
            <DialogDescription>
              {initialCustomer
                ? `Starting from ${customers.data?.find((customer) => customer.id === initialCustomer)?.name ?? "the selected customer"}’s saved property. `
                : ""}
              Search for an address and the pin drops on the building itself; move it if it lands on
              the wrong one. For apartment complexes or condos, click to drop multiple pins on each
              structure. Each pin will create a separate report. Double-click a pin to remove it.
              The roof is then measured automatically from public LiDAR data, the report PDF is
              generated and saved, and a material list is built from the measurement — you can
              review or adjust every result afterwards.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createReport();
            }}
          >
            <section className="space-y-2" aria-label="Property satellite map">
              <div className="relative h-[min(64vh,560px)] min-h-[340px] overflow-hidden rounded-md border border-border bg-muted">
                {locatedAddress && mapCenter ? (
                  <SatelliteMap
                    center={mapCenter}
                    zoom={mapZoom}
                    pins={mapPins}
                    label={`Satellite map of ${locatedAddress.matchedAddress}`}
                    onZoomChange={setMapZoom}
                    onCenterChange={setMapCenter}
                    onPinMove={movePin}
                    onMapClick={addPin}
                    onPinDoubleClick={removePin}
                  />
                ) : (
                  <div className="grid h-full place-items-center p-6 text-center">
                    <div className="max-w-sm">
                      <MapPin className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                      <p className="font-semibold">Property map</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Search an address and select “Locate” to load satellite imagery and drop the
                        first pin on the building.
                      </p>
                    </div>
                  </div>
                )}
                <div className="absolute inset-x-3 top-3 z-20 flex gap-2">
                  <Input
                    aria-label="Customer property address"
                    className="bg-background shadow"
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
                      setMapCenter(null);
                      setPins([]);
                      setFootprintPin(null);
                      setAddressError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void locateAddress();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    className="shadow"
                    disabled={lookupBusy || form.address.trim().length < 8}
                    onClick={() => void locateAddress()}
                  >
                    <MapPin /> {lookupBusy ? "Locating…" : "Locate"}
                  </Button>
                </div>
                {locatedAddress && (
                  <>
                    <div className="absolute right-3 top-[68px] z-20 flex flex-col gap-1">
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
                        onClick={() => {
                          setMapZoom(SATELLITE_DEFAULT_ZOOM);
                          setMapCenter({ lat: locatedAddress.lat, lon: locatedAddress.lon });
                        }}
                      >
                        Reset
                      </Button>
                    </div>
                    <div className="absolute bottom-3 left-3 z-20 max-w-[85%] rounded bg-background/95 px-3 py-2 text-xs shadow">
                      <strong className="block">
                        {pins.length === 1 ? "1 building pin" : `${pins.length} building pins`}
                      </strong>
                      {locatedAddress.matchedAddress}
                    </div>
                    <div className="absolute bottom-3 right-3 z-20 rounded bg-background/95 px-2 py-1 text-[11px] font-medium shadow">
                      Satellite imagery · Esri
                    </div>
                  </>
                )}
              </div>
              {addressError && (
                <p role="alert" className="text-sm text-destructive">
                  {addressError}
                </p>
              )}
              {locatedAddress && (
                <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                  <p className="font-semibold">Address matched</p>
                  <p className="mt-1">{locatedAddress.matchedAddress}</p>
                  {pins.map((pin, index) => (
                    <p key={index} className="mt-1 text-xs text-muted-foreground">
                      Pin {index + 1}: {pin.lat.toFixed(6)}, {pin.lon.toFixed(6)}
                      {index === 0 &&
                      footprintPin &&
                      pin.lat === footprintPin.lat &&
                      pin.lon === footprintPin.lon
                        ? " · building footprint"
                        : index === 0 &&
                            pin.lat === locatedAddress.lat &&
                            pin.lon === locatedAddress.lon
                          ? " · geocoded address point"
                          : ""}
                    </p>
                  ))}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Drag a pin onto the correct building — each measurement uses its pin’s final
                    position. Drag the map to look around, scroll to zoom, click to add a pin for
                    another structure, and double-click a pin to remove it.
                  </p>
                </div>
              )}
            </section>
            <Field label="Select Building Type">
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Building type">
                {BUILDING_TYPES.map((type) => {
                  const Icon =
                    type.value === "single_family"
                      ? Home
                      : type.value === "multi_family"
                        ? Building2
                        : Building;
                  const selected = buildingType === type.value;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setBuildingType(type.value)}
                      className={`flex flex-col items-center gap-2 rounded-md border px-3 py-4 text-sm font-medium ${
                        selected
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-primary/50"
                      }`}
                    >
                      <Icon className="size-6" />
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={includeOutbuilding}
                onCheckedChange={(checked) => setIncludeOutbuilding(checked === true)}
              />
              Include outbuilding
            </label>
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
            <Field label="Notes (Optional)">
              <Textarea
                value={form.notes}
                maxLength={4000}
                placeholder="(i.e. dormer pitch 6/12, include detached shed, do not include metal awnings, flat section only, etc.)"
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
            <Button
              disabled={
                busy ||
                lookupBusy ||
                !locatedAddress ||
                pins.length === 0 ||
                form.address.trim() !== locatedAddress.matchedAddress
              }
              type="submit"
            >
              <Plus />{" "}
              {busy
                ? "Creating…"
                : pins.length > 1
                  ? `Create ${pins.length} reports and measure roofs`
                  : "Create and measure roof"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
