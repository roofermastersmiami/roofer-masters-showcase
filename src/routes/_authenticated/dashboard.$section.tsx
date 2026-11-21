import {createFileRoute,notFound} from '@tanstack/react-router';
import {CrmSection,CRM_SECTIONS} from '@/components/dashboard/CrmSection';
import {pageMeta} from '@/lib/seo';
export const Route=createFileRoute('/_authenticated/dashboard/$section')({beforeLoad:({params})=>{if(!CRM_SECTIONS.some(s=>s===params.section))throw notFound();},head:({params})=>({meta:[...pageMeta(`${params.section.replaceAll('_',' ')} | Roofer Masters CRM`,'Manage your private Roofer Masters customer and roofing business records.'),{name:'robots',content:'noindex,nofollow'}]}),component:Section});
function Section(){const {section}=Route.useParams();return <CrmSection key={section} section={section}/>;}