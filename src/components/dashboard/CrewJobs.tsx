import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { myCrewJobs } from "@/lib/team.functions";
import { SectionHeading } from "./CrmControls";
export function CrewJobs() {
  const fn = useServerFn(myCrewJobs);
  const jobs = useQuery({ queryKey: ["my-crew-jobs"], queryFn: () => fn() });
  return (
    <div>
      <SectionHeading title="My assigned jobs" />
      {jobs.isPending ? (
        <p>Loading…</p>
      ) : jobs.error ? (
        <p role="alert" className="text-destructive">
          Jobs could not load.
        </p>
      ) : !jobs.data?.length ? (
        <p className="text-muted-foreground">No jobs are assigned to you yet.</p>
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {jobs.data.map((j) => {
            const list = Array.isArray(j.checklist)
              ? (j.checklist as { label?: string; done?: boolean }[])
              : [];
            return (
              <article key={j.id} className="py-4">
                <h3 className="text-lg font-bold">{j.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {j.address || "Address not set"} · {j.status.replaceAll("_", " ")} · Start{" "}
                  {j.start_date ?? "TBD"} · Permit {j.permit_status}
                </p>
                {list.length > 0 && (
                  <ul className="mt-2 text-sm">
                    {list.map((c, i) => (
                      <li key={i}>
                        {c.done ? "✓" : "○"} {c.label}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
