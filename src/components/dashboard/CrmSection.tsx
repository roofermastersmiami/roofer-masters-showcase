import {RoofMeasurements} from './RoofMeasurements';
import {Pipeline} from './Pipeline';
import {LeadsTable} from './LeadsTable';
import {Customers} from './Customers';
import {Properties} from './Properties';
import {ChatInbox} from './ChatInbox';
import {Proposals} from './Proposals';
import {Estimates} from './Estimates';
import {Jobs} from './Jobs';
import {Invoices} from './Invoices';
import {FollowUps} from './FollowUps';
import {SalesReport} from './SalesReport';
import {ContentEditor} from './ContentEditor';
import {InstantEstimateSettings} from './InstantEstimateSettings';
import {useCrm} from './CrmContext';
import {useState} from 'react';
export const CRM_SECTIONS=['measurements','pipeline','submissions','customers','properties','chat','proposals','estimates','jobs','invoices','followups','sales','content','instant'] as const;
export function CrmSection({section}:{section:string}){
 const {leads,onOpen,openProposals,proposalLeadId,clearProposalLead}=useCrm();const [chatId,setChatId]=useState<string|null>(null);
 switch(section){
 case 'measurements':return <RoofMeasurements/>;
 case 'pipeline':return <Pipeline leads={leads} onOpen={onOpen}/>;
 case 'submissions':return <LeadsTable leads={leads} onOpen={onOpen}/>;
 case 'customers':return <Customers leads={leads} onOpen={onOpen}/>;
 case 'properties':return <Properties/>;
 case 'chat':return <ChatInbox leads={leads} selectedId={chatId} onSelect={setChatId} onOpenLead={onOpen}/>;
 case 'proposals':return <Proposals leads={leads} requestedLeadId={proposalLeadId} onRequestHandled={clearProposalLead}/>;
 case 'estimates':return <Estimates leads={leads} onOpenProposals={()=>openProposals()}/>;
 case 'jobs':return <Jobs leads={leads}/>;
 case 'invoices':return <Invoices leads={leads}/>;
 case 'followups':return <FollowUps leads={leads} onOpenLead={onOpen} onOpenProposals={()=>openProposals()}/>;
 case 'sales':return <SalesReport leads={leads}/>;
 case 'content':return <ContentEditor/>;
 case 'instant':return <InstantEstimateSettings/>;
 default:return null;
 }
}