import {createFileRoute,Outlet,useNavigate} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {isOwnerQuery} from '@/components/dashboard/data';
import {CrmShell} from '@/components/dashboard/CrmShell';
import {BUSINESS} from '@/lib/site';
import {pageMeta} from '@/lib/seo';
export const Route=createFileRoute('/_authenticated/dashboard')({head:()=>({meta:[...pageMeta('Workspace | Roofer Masters CRM','Private customer, roofing production and financial workspace.'),{name:'robots',content:'noindex,nofollow'}]}),component:Dashboard});
function Dashboard(){
 const {user}=Route.useRouteContext();const owner=useQuery(isOwnerQuery(user.id));const qc=useQueryClient();const navigate=useNavigate();
 async function signOut(){await qc.cancelQueries();qc.clear();await supabase.auth.signOut();void navigate({to:'/auth',replace:true});}
 if(owner.isPending)return <p className="py-20 text-center text-muted-foreground">Loading your workspace…</p>;
 if(owner.error)return <p role="alert" className="p-8 text-destructive">Owner access could not be verified. Refresh to try again.</p>;
 if(!owner.data)return <div className="mx-auto max-w-lg p-8 text-center"><h1 className="text-2xl font-bold">No owner access</h1><p className="mt-3 text-muted-foreground">Sign in with {BUSINESS.email} after confirming your email to manage your business.</p><Button className="mt-6" variant="outline" onClick={()=>void signOut()}>Sign in with another account</Button></div>;
 return <CrmShell email={user.email??''} onSignOut={()=>void signOut()}><Outlet/></CrmShell>;
}
