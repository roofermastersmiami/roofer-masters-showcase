import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { seedFinishedMeasurements } from "@/lib/measurement-activity";
import { useAutoFinishReports } from "./use-auto-finish";
import { customersQuery } from "./foundation-data";
import { drawingsQuery } from "./roof-data";
import { roofOrdersQuery } from "./roof-orders-data";

/**
 * The CRM shell's background measurement runner. Mounted once for the
 * whole signed-in session, it feeds every still-awaiting roof report
 * into the shared auto-finish engine (the same one the Roof reports
 * list and the Roof measurements tab use), so measurements keep
 * running — and finish — while the user works anywhere else in the
 * CRM: calendar, customers, a new customer entry, anything. The
 * queries share their cache keys with the report surfaces, so this
 * costs no extra fetching, and completions surface through the
 * measurement activity store (header indicator + "report ready"
 * toast) rather than on any one page.
 */
export function useMeasurementRunner() {
  const orders = useQuery(roofOrdersQuery);
  const drawings = useQuery(drawingsQuery);
  const customers = useQuery(customersQuery);
  useAutoFinishReports(orders.data, drawings.data, customers.data);

  // "Ready while you were away": the first orders snapshot of the
  // session seeds activity entries for reports whose PDFs landed
  // after the user's last visit. Later snapshots are this session's
  // own finishes, which the engine records itself.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !orders.data) return;
    seeded.current = true;
    seedFinishedMeasurements(orders.data);
  }, [orders.data]);
}
