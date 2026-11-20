import { useEffect, useState } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CONTENT_KEYS, siteContentQuery, type SiteContent } from "@/lib/content.functions";

const LABELS: Record<keyof SiteContent, { label: string; help: string; long?: boolean }> = {
  hero_headline: { label: "Homepage headline", help: "The big title at the top of the homepage." },
  hero_subheadline: { label: "Homepage sub-headline", help: "One or two sentences under the headline.", long: true },
  announcement: { label: "Announcement bar", help: "Thin strip above the menu on every page. Leave empty to hide it." },
};

export function ContentEditor() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(siteContentQuery);
  const [values, setValues] = useState<SiteContent>(data);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValues(data), [data]);

  async function save() {
    setSaving(true);
    const rows = CONTENT_KEYS.map((key) => ({ key, value: values[key] }));
    const { error } = await supabase.from("site_content").upsert(rows);
    setSaving(false);
    if (error) {
      toast.error("Could not save changes");
      return;
    }
    toast.success("Website updated");
    qc.invalidateQueries({ queryKey: ["site-content"] });
  }

  return (
    <div className="max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-card">
      <h2 className="text-xl font-black text-foreground">Website text</h2>
      <p className="mt-1 text-sm text-muted-foreground">Changes appear on the live site right away.</p>
      <div className="mt-6 grid gap-5">
        {CONTENT_KEYS.map((key) => {
          const meta = LABELS[key];
          return (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={key} className="font-bold">{meta.label}</Label>
              {meta.long ? (
                <Textarea id={key} rows={3} value={values[key]} maxLength={300} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
              ) : (
                <Input id={key} className="h-11" value={values[key]} maxLength={140} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
              )}
              <p className="text-xs text-muted-foreground">{meta.help}</p>
            </div>
          );
        })}
      </div>
      <Button variant="hero" size="lg" className="mt-6" disabled={saving} onClick={save}>Save changes</Button>
    </div>
  );
}
