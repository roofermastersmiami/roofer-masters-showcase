import {useRoles} from '@/components/dashboard/RolesContext';
import {CrewJobs} from '@/components/dashboard/CrewJobs';
import {seesMoney,ROLE_LABELS,type TeamRole} from '@/lib/team-roles';
import {createFileRoute} from '@tanstack/react-router';
import {CrmOverview} from '@/components/dashboard/CrmOverview';
import {pageMeta} from '@/lib/seo';
export const Route=createFileRoute('/_authenticated/dashboard/')({head:()=>({meta:[...pageMeta('Business Overview | Roofer Masters CRM','Your recorded roofing sales, payments, projects and customer activity.'),{name:'robots',content:'noindex,nofollow'}]}),component:Home});
function Home(){const roles=useRoles();if(roles.includes('crew')&&roles.length===1)return <CrewJobs/>;if(!seesMoney(roles))return <div><h2 className="mb-3 text-2xl font-bold">Welcome</h2><p className="text-muted-foreground">Use the menu to open the sections your role ({roles.map(r=>ROLE_LABELS[r as TeamRole]??r).join(', ')}) can access. Financial totals are limited to Owner and Accounting.</p></div>;return <CrmOverview/>;}