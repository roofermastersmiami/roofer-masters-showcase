import {createFileRoute,Outlet,useNavigate} from '@tanstack/react-router';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {myRolesQuery,RolesContext} from '@/components/dashboard/RolesContext';
import {CrmShell} from '@/components/dashboard/CrmShell';
import {BUSINESS} from '@/lib/site';
import {pageMeta} from '@/lib/seo';
export const Route=createFileRoute('/_authenticated/dashboard')({head:()=>({meta:[...pageMeta('Workspace | Roofer Masters CRM','Private customer, roofing production and financial workspace.'),{name:'robots',content:'noindex,nofollow'}]}),component:Dashboard});
function Dashboard(){
 const {user}=Route.useRouteContext();const owner=useQuery(myRolesQuery(user.id));const qc=useQueryClient();const navigate=useNavigate();
 async function signOut(){await qc.cancelQueries();qc.clear();await supabase.auth.signOut();void navigate({to:'/auth',replace:true});}
 if(owner.isPending)return <p className="py-20 text-center text-muted-foreground">Loading your workspace…</p>;
 if(owner.error)return <p role="alert" className="p-8 text-destructive">Team access could not be verified. Refresh to try again.</p>;
 if(!owner.data.length)return <div className="mx-auto max-w-lg p-8 text-center"><h1 className="text-2xl font-bold">No CRM access yet</h1><p className="mt-3 text-muted-foreground">Ask the owner to give your account a team role. The owner signs in with {BUSINESS.email}.</p><Button className="mt-6" variant="outline" onClick={()=>void signOut()}>Sign in with another account</Button></div>;
 return <RolesContext.Provider value={owner.data}><CrmShell email={user.email??''} onSignOut={()=>void signOut()}><Outlet/></CrmShell></RolesContext.Provider>;
}
