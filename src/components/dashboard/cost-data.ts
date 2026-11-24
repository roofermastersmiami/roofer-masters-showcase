import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";
function configuredStripeEnvironment() {
  try {
    return getStripeEnvironment();
  } catch {
    // Expenses are environment-scoped; do not crash CRM routes when payments are not configured.
    return "live";
  }
}
export const costCatalogQuery = queryOptions({
  queryKey: ["roof-cost-catalog"],
  queryFn: async () => {
    const { data, error } = await supabase.from("roof_cost_catalog").select("*").order("item");
    if (error) throw error;
    return data ?? [];
  },
});
export const invoiceProjectLinksQuery = queryOptions({
  queryKey: ["invoice-project-links"],
  queryFn: async () => {
    const { data, error } = await supabase.from("invoice_project_links").select("*");
    if (error) throw error;
    return data ?? [];
  },
});
export const expensesQuery = queryOptions({
  queryKey: ["crm-expenses"],
  queryFn: async () => {
    const environment = configuredStripeEnvironment();
    if (!environment) return [];
    const { data, error } = await supabase
      .from("crm_expenses")
      .select("*")
      .eq("environment", environment)
      .order("incurred_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
  refetchInterval: 30000,
});
