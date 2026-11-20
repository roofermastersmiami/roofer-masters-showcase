import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { FileText, Download, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/site/Logo";
import { getSharedProposal } from "@/lib/proposals.functions";

const sharedQuery = (token: string) => queryOptions({ queryKey: ["shared-proposal", token], queryFn: () => getSharedProposal({ data: { token } }), staleTime: 0 });
export const Route = createFileRoute("/proposal/$token")({
  head: () => ({ meta: [
    { title: "Your Roofing Proposal | Roofer Masters" },
    { name: "description", content: "View your private roofing proposal from Roofer Masters." },
    { property: "og:title", content: "Your Roofing Proposal | Roofer Masters" },
    { property: "og:description", content: "View your private roofing proposal from Roofer Masters." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
    { name: "referrer", content: "no-referrer" },
  ] }),
  loader: ({ params, context }) => context.queryClient.ensureQueryData(sharedQuery(params.token)),
  component: SharedProposal,
});
function SharedProposal() {
  const { token } = Route.useParams();
  const { data } = useSuspenseQuery(sharedQuery(token));
  return <div className="min-h-screen bg-muted">
    <header className="border-b border-border bg-card"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4"><Logo className="h-14" /><Button asChild variant="outline"><a href="tel:3059423093"><Phone /> 305-942-3093</a></Button></div></header>
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      {data ? <><div className="mb-5 flex flex-wrap items-center justify-between gap-4"><h1 className="break-words text-2xl font-bold">{data.title}</h1><Button asChild><a href={data.url} target="_blank" rel="noopener noreferrer"><Download /> Open / download PDF</a></Button></div><iframe src={data.url} title={data.title} className="h-[75dvh] w-full border border-border bg-card" /></>
        : <div className="py-20 text-center"><FileText className="mx-auto mb-4 size-10 text-muted-foreground" /><h1 className="text-2xl font-bold">Proposal link unavailable</h1><p className="mt-3 text-muted-foreground">This link has expired or been revoked. Call Roofer Masters for a new copy.</p></div>}
    </main>
  </div>;
}