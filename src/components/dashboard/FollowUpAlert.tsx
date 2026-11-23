import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tasksQuery } from "./operations-data";
export function FollowUpAlert({ onOpen }: { onOpen: () => void }) {
  const { data } = useQuery(tasksQuery);
  const overdue =
    data?.filter((t) => !t.completed_at && Date.parse(t.due_at) < Date.now()).length ?? 0;
  if (!overdue) return null;
  return (
    <Button variant="outline" className="mt-5 border-warning/40 bg-warning/10" onClick={onOpen}>
      <Clock /> {overdue} overdue follow-up{overdue === 1 ? "" : "s"}
    </Button>
  );
}
