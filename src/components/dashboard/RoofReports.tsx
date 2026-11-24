import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ArrowRight, MapPin, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { createRoofOrder } from "@/lib/roof-orders.functions";
import { lookupRoofAddress } from "@/lib/roof-address.functions";
import { roofOrderSchema } from "@/lib/roof-order-schema";
import { customersQuery } from "./foundation-data";
import { drawingsQuery } from "./roof-data";
import { roofOrdersQuery } from "./roof-orders-data";
import { RoofMeasurements } from "./RoofMeasurements";
import { Field, SectionHeading, Empty } from "./CrmControls";

type LocatedAddress = { matchedAddress: string; lat: number; lon: number };

export function RoofReports({
  initialCustomer,
  initialPropertyId,
  initialAddress = "",
}: {
  initialCustomer?: string;
  initialPropertyId?: string;
  initialAddress?: string;
}) {
  const customers = useQuery(customersQuery),
    orders = useQuery(roofOrdersQuery),
    drawings = useQuery(drawingsQuery),
    qc = useQueryClient();
  const create = useServerFn(createRoofOrder);
  const lookup = useServerFn(lookupRoofAddress);
  const [adding, setAdding] = useState(!!initialAddress),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [lookupBusy, setLookupBusy] = useState(false),
    [search, setSearch] = useState(""),
    [legacy, setLegacy] = useState(false),
    [locatedAddress, setLocatedAddress] = useState<LocatedAddress | null>(null),
    [addressError, setAddressError] = useState("");
  const [form, setForm] = useState({
    address: initialAddress,
    title: "Roof measurement report",
    provider: "manual" as const,
    notes: "",
  });
  const report = orders.data?.find((r) => r.id === selected);
  const matchingPropertyReport = initialPropertyId
    ? orders.data?.find((r) => r.property_id === initialPropertyId)
    : initialAddress
      ? orders.data?.find((r) => r.address.trim().toLowerCase() === initialAddress.trim().toLowerCase())
      : undefined;

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
        error instanceof Error
          ? error.message
          : "The address lookup could not complete. Please retry.",
      );
    } finally {
      setLookupBusy(false);
    }
  }

  const initialLookupStarted = useRef(false);
  useEffect(() => {
    if (!initialAddress || orders.isPending || initialLookupStarted.current) return;
    initialLookupStarted.current = true;
    if (matchingPropertyReport) {
      setSelected(matchingPropertyReport.id);
      setAdding(false);
      return;
    }
    setAdding(true);
    const address = initialAddress.trim();
    setLookupBusy(true);
    setAddressError("");
    void (async () => {
      try {
        const result = await lookup({ data: { address } });
        if ("error" in result) {
          setAddressError(result.error);
          return;
        }
        setLocatedAddress(result);
        setForm((current) => ({ ...current, address: result.matchedAddress }));
        toast.success("Saved property address located");
      } catch (error) {
        setAddressError(
          error instanceof Error ? error.message : "The saved property address could not be located.",
        );
      } finally {
        setLookupBusy(false);
      }
    })();
  }, [initialAddress, orders.isPending, matchingPropertyReport?.id, lookup]);

  async function submit() {
    if (!locatedAddress || form.address.trim() !== locatedAddress.matchedAddress) {
      toast.error("Locate and confirm the property address before creating the report");
      return;
    }
    const parsed = roofOrderSchema.safeParse({
      ...form,
      address: locatedAddress.matchedAddress,
    });
    if (!parsed.success) {
      toast.error("Enter the complete property address");
      return;
    }
    setBusy(true);
    try {
      const result = await create({ data: parsed.data });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["roof-report-orders"] }),
        qc.invalidateQueries({ queryKey: ["crm-properties"] }),
      ]);
      setAdding(false);
      setSelected(result.id);
      toast.success("Your address-linked roof report is ready for measurement");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create roof report");
    } finally {
      setBusy(false);
    }
  }

  if (legacy)
    return (
      <div>
        <Button className="mb-5" variant="outline" onClick={() => setLegacy(false)}>
          <ArrowLeft /> All roof reports
        </Button>
        <RoofMeasurements />
      </div>
    );

  if (report)
    return (
      <div>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => setSelected(null)}>
            <ArrowLeft /> All roof reports
          </Button>
          <div className="min-w-0">
            <p className="break-words font-semibold">{report.address}</p>
            <p className="text-xs text-muted-foreground">
              {customers.data?.find((c) => c.id === report.customer_id)?.name} · Roofer Masters
              measurement report
            </p>
          </div>
        </div>
        {drawings.isPending ? (
          <p>Loading saved measurements…</p>
        ) : drawings.error ? (
          <p role="alert">Saved measurements could not load. Refresh before editing.</p>
        ) : (
          <RoofMeasurements
            key={report.id}
            report={report}
            initialDrawing={drawings.data?.find((d) => d.id === report.drawing_id) ?? null}
          />
        )}
      </div>
    );

  const rows = (orders.data ?? []).filter((r) =>
    `${r.address} ${r.title} ${customers.data?.find((c) => c.id === r.customer_id)?.name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  return (
    <div>
      <SectionHeading
        title="Roof reports"
        action={
          <Button
            onClick={() => {
              setForm({
                address: initialAddress,
                title: "Roof measurement report",
                provider: "manual",
                notes: "",
              });
              setLocatedAddress(null);
              setAddressError("");
              setAdding(true);
            }}
          >
            <Plus /> Create report by address
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search roof reports"
            placeholder="Search customer or property address…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" onClick={() => setLegacy(true)}>
          Existing drawings workspace
        </Button>
        <p className="text-sm text-muted-foreground">Roofer Masters · Company-owned reports</p>
      </div>
      {orders.error && (
        <p role="alert" className="text-destructive">
          Roof reports could not load.
        </p>
      )}
      {orders.isPending ? (
        <p>Loading roof reports…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <article
              key={row.id}
              className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5"
            >
              <MapPin className="size-5 text-primary" />
              <button
                type="button"
                className="mt-3 break-words text-left text-lg font-bold text-primary underline-offset-4 hover:underline"
                onClick={() => setSelected(row.id)}
                aria-label={`Open 2D and 3D roof workspace for ${row.address}`}
              >
                {row.address}
              </button>
              <p className="mt-2 text-sm">
                {customers.data?.find((c) => c.id === row.customer_id)?.name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{row.title}</p>
              <p className="my-4 text-xs font-semibold text-muted-foreground">
                {row.status === "reviewed"
                  ? "Owner-reviewed measurements"
                  : row.drawing_id
                    ? "Drawing saved · awaiting review"
                    : "Awaiting measurements"}{" "}
                · {new Date(row.created_at).toLocaleDateString()}
              </p>
              <Button variant="outline" className="mt-auto" onClick={() => setSelected(row.id)}>
                Open measurement report <ArrowRight />
              </Button>
            </article>
          ))}
        </div>
      )}
      {!orders.isPending && !orders.error && !rows.length && <Empty>No roof reports yet.</Empty>}
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
              Enter the complete property address and locate it first. This confirms the map
              coordinates before creating the report. Roof facets and dimensions still require a
              verified roof source or calibrated tracing.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
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
              <Plus /> {busy ? "Creating…" : "Create my roof report"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
