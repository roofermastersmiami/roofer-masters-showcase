import { useRoles } from "./RolesContext";
import { canOpen } from "@/lib/team-roles";
import { TeamAccess } from "./TeamAccess";
import { CrewJobs } from "./CrewJobs";
import { RoofReports } from "./RoofReports";
import { CrmCalendar } from "@/components/CrmCalendar";
import { RoofMeasurementsTab } from "./RoofMeasurementsTab";
import { AdvancedEstimator } from "./AdvancedEstimator";
import { CostCatalog } from "./CostCatalog";
import { Expenses } from "./Expenses";
import { FinancialAnalytics } from "./FinancialAnalytics";
import { Pipeline } from "./Pipeline";
import { LeadsTable } from "./LeadsTable";
import { Customers } from "./Customers";
import { Properties } from "./Properties";
import { ChatInbox } from "./ChatInbox";
import { Proposals } from "./Proposals";
import { Estimates } from "./Estimates";
import { Jobs } from "./Jobs";
import { Invoices } from "./Invoices";
import { FollowUps } from "./FollowUps";
import { SalesReport } from "./SalesReport";
import { ContentEditor } from "./ContentEditor";
import { InstantEstimateSettings } from "./InstantEstimateSettings";
import { useCrm } from "./CrmContext";
import { useState } from "react";
export const CRM_SECTIONS = [
  "detailed-estimator",
  "prices",
  "expenses",
  "financials",
  "roof-reports",
  "appointments",
  "measurements",
  "pipeline",
  "submissions",
  "customers",
  "properties",
  "chat",
  "proposals",
  "estimates",
  "jobs",
  "invoices",
  "followups",
  "sales",
  "content",
  "instant",
  "team",
  "my-jobs",
] as const;
export function CrmSection({ section }: { section: string }) {
  const {
    leads,
    onOpen,
    openProposals,
    proposalLeadId,
    clearProposalLead,
    roofReportRequest,
    clearRoofReportRequest,
    selectedRoofReportId,
    openRoofMeasurements,
  } = useCrm();
  const [chatId, setChatId] = useState<string | null>(null);
  const roles = useRoles();
  if (!canOpen(roles, section))
    return (
      <p role="alert" className="py-10 text-muted-foreground">
        Your team role does not include this section.
      </p>
    );
  switch (section) {
    case "detailed-estimator":
      return <AdvancedEstimator />;
    case "team":
      return <TeamAccess />;
    case "my-jobs":
      return <CrewJobs />;
    case "prices":
      return <CostCatalog />;
    case "expenses":
      return <Expenses />;
    case "financials":
      return <FinancialAnalytics />;
    case "roof-reports":
      return <RoofReports onOpenMeasurement={openRoofMeasurements} />;
    case "appointments":
      return <CrmCalendar onOpenRoofReport={openRoofMeasurements} />;
    case "measurements":
      return (
        <RoofMeasurementsTab
          selectedReportId={selectedRoofReportId}
          onSelectReport={openRoofMeasurements}
          initialCustomer={roofReportRequest?.customerId}
          initialPropertyId={roofReportRequest?.propertyId}
          initialAddress={roofReportRequest?.address ?? ""}
          onRequestHandled={clearRoofReportRequest}
        />
      );
    case "pipeline":
      return <Pipeline leads={leads} onOpen={onOpen} />;
    case "submissions":
      return <LeadsTable leads={leads} onOpen={onOpen} />;
    case "customers":
      return <Customers leads={leads} onOpen={onOpen} />;
    case "properties":
      return <Properties />;
    case "chat":
      return (
        <ChatInbox leads={leads} selectedId={chatId} onSelect={setChatId} onOpenLead={onOpen} />
      );
    case "proposals":
      return (
        <Proposals
          leads={leads}
          requestedLeadId={proposalLeadId}
          onRequestHandled={clearProposalLead}
        />
      );
    case "estimates":
      return <Estimates leads={leads} onOpenProposals={() => openProposals()} />;
    case "jobs":
      return <Jobs leads={leads} />;
    case "invoices":
      return <Invoices leads={leads} />;
    case "followups":
      return (
        <FollowUps leads={leads} onOpenLead={onOpen} onOpenProposals={() => openProposals()} />
      );
    case "sales":
      return <SalesReport leads={leads} />;
    case "content":
      return <ContentEditor />;
    case "instant":
      return <InstantEstimateSettings />;
    default:
      return null;
  }
}
