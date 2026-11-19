import { createFileRoute, Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import heroImg from "@/assets/service-flat.webp";
import { PageHero } from "@/components/site/PageHero";
import { Reveal } from "@/components/site/Reveal";
import { CtaBand } from "@/components/site/CtaBand";
import { ServiceAreaMap } from "@/components/site/ServiceAreaMap";
import { AREAS } from "@/lib/site";
import { pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/service-areas")({
  head: () => ({
    meta: pageMeta(
      "Service Areas | Roofer in Miami-Dade & Broward County | Roofer Masters",
      "Roofer Masters serves Homestead, Kendall, Cutler Bay, Miami, Hialeah, Coral Gables, Doral, Fort Lauderdale, Hollywood, Pembroke Pines and surrounding cities.",
    ),
  }),
  component: AreasPage,
});

function AreasPage() {
  return (
    <>
      <PageHero eyebrow="Service areas" title="Roofing across Miami-Dade & Broward" image={heroImg}>
        Based in Homestead and on the road every day, from Florida City to Coral Springs.
      </PageHero>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-10">
          {AREAS.map((area, i) => (
            <Reveal key={area.county} delay={i * 100}>
              <h2 className="text-3xl font-black text-foreground sm:text-4xl">{area.county} County</h2>
              <p className="mt-2 text-muted-foreground">
                {area.county === "Miami-Dade"
                  ? "Our home turf. Roof replacement in Miami-Dade, metal roof installation in Homestead and repairs countywide."
                  : "Trusted roofer in Broward County for homes and businesses from Hollywood to Coral Springs."}
              </p>
              <ul className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {area.cities.map((c) => (
                  <li key={c} className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-semibold text-foreground shadow-card">
                    <MapPin className="size-4 shrink-0 text-primary" /> {c}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
          <p className="text-sm text-muted-foreground">
            Don't see your city? We likely serve it.{" "}
            <Link to="/contact" className="font-bold text-primary">
              Ask us →
            </Link>
          </p>
        </div>
        <Reveal delay={150} className="lg:sticky lg:top-28 lg:self-start">
          <ServiceAreaMap className="h-[420px] lg:h-[600px]" />
        </Reveal>
      </section>

      <CtaBand />
    </>
  );
}
