import { createContext, useContext } from "react";
import type { Lead } from "./data";
export type CrmState = {
  leads: Lead[];
  onOpen: (lead: Lead) => void;
  openProposals: (leadId?: string) => void;
  proposalLeadId: string | null;
  clearProposalLead: () => void;
  go: (section: string) => void;
};
export const CrmContext = createContext<CrmState | null>(null);
export function useCrm() {
  const value = useContext(CrmContext);
  if (!value) throw new Error("CRM workspace missing");
  return value;
}
