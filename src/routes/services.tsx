import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Phone } from "lucide-react";
import heroImg from "@/assets/service-metal.webp";
import { PageHero } from "@/components/site/PageHero";
import { Reveal } from "@/components/site/Reveal";
import { CtaBand } from "@/components/site/CtaBand";
import { Button } from "@/components/ui/button";
import { BUSINESS, SERVICES } from "@/lib/site";
import { pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: pageMeta(
      "Roofing Services Miami-Dade & Broward | Metal, Tile, Shingle, Flat | Roofer Masters",
      "Metal roof installation in Homestead, tile and shingle roofing, TPO and hot mop flat roofs, roof replacement, roof repairs and seamless gutters across Miami-Dade and Broward.",
    ),
  }),
  component: ServicesPage,
});

function ServicesPage() {
  return (
    <>
      <PageHero eyebrow="Our services" title="Every roof type. One master crew." image={heroImg}>
        Metal, tile, shingle and flat roofs, plus replacements, repairs and gutters, all installed
        to South Florida's toughest building codes.
      </PageHero>

      <nav
        aria-label="Services"
        className="sticky top-[4.5rem] z-30 border-b border-border bg-card/95 backdrop-blur lg:top-20"
      >
        <div className="no-scrollbar mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3 sm:px-6">
          {SERVICES.map((s) => (
            <a
              key={s.slug}
              href={`#${s.slug}`}
              className="whitespace-nowrap rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:border-primary hover:text-primary"
            >
              {s.name}
            </a>
          ))}
        </div>
      </nav>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {SERVICES.map((s, i) => (
          <section
            key={s.slug}
            id={s.slug}
            className="grid scroll-mt-40 items-center gap-10 border-b border-border py-16 last:border-0 md:py-24 lg:grid-cols-2 lg:gap-16"
          >
            <Reveal className={i % 2 ? "lg:order-2" : ""}>
              <div className="relative">
                <img
                  src={s.image}
                  alt={`${s.name} project by Roofer Masters in South Florida`}
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-3xl object-cover shadow-elegant"
                />
                <span className="absolute left-4 top-4 rounded-full bg-card/95 px-4 py-1.5 font-display text-sm font-extrabold text-primary shadow-card">
                  0{i + 1}
                </span>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <p className="eyebrow text-primary">Service 0{i + 1}</p>
              <h2 className="mt-3 text-3xl font-black text-foreground sm:text-4xl md:text-5xl">
                {s.name}
              </h2>
              <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
                {s.description}
              </p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {s.benefits.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-3 rounded-xl bg-accent/60 p-3 text-sm font-semibold text-foreground"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3.5" />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild variant="hero" size="xl">
                  <Link to="/contact" search={{ service: s.name }}>
                    Get a {(s.name.split(" (")[0] ?? s.name).toLowerCase()} quote
                  </Link>
                </Button>
                <Button asChild variant="outline" size="xl">
                  <a href={BUSINESS.phoneHref}>
                    <Phone /> {BUSINESS.phoneDisplay}
                  </a>
                </Button>
              </div>
            </Reveal>
          </section>
        ))}
      </div>

      <CtaBand title="Not sure which roof is right for you?" />
    </>
  );
}
