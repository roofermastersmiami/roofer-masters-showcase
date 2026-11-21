import {createFileRoute} from '@tanstack/react-router';
import {CrmOverview} from '@/components/dashboard/CrmOverview';
import {pageMeta} from '@/lib/seo';
export const Route=createFileRoute('/_authenticated/dashboard/')({head:()=>({meta:[...pageMeta('Business Overview | Roofer Masters CRM','Your recorded roofing sales, payments, projects and customer activity.'),{name:'robots',content:'noindex,nofollow'}]}),component:CrmOverview});