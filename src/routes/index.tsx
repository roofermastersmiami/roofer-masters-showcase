import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, CloudLightning, Hammer, Languages, MapPin, Phone, ShieldCheck, Star } from "lucide-react";
import heroImg from "@/assets/hero-metal-roof.webp";
import beforeMetal from "@/assets/before-metal.webp";
import beforeShingle from "@/assets/before-shingle.webp";
import shingleImg from "@/assets/service-shingle.webp";
import crewImg from "@/assets/about-crew.webp";
import { Button } from "@/components/ui/button";
import { LeadForm } from "@/components/site/LeadForm";
import { Reveal } from "@/components/site/Reveal";
import { SectionHeading } from "@/components/site/PageHero";
import { BeforeAfter } from "@/components/site/BeforeAfter";
import { ReviewCard, Stars } from "@/components/site/ReviewCard";
import { CtaBand } from "@/components/site/CtaBand";
import { WhatsAppIcon } from "@/components/site/SocialIcons";
import { siteContentQuery } from "@/lib/content.functions";
import { AREAS, BUSINESS, SERVICES } from "@/lib/site";
import { REVIEWS } from "@/lib/reviews";
import { localBusinessJsonLd, pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: pageMeta(
      "Roofing Company Miami-Dade & Broward | Roofer Masters, Homestead FL",
      "Storm-ready metal, tile, shingle and flat roofs from a local Homestead roofer. Roof replacement in Miami-Dade, roofer in Broward County. Call 305-942-3093.",
    ),
    scripts: [{ type: "application/ld+json", children: JSON.stringify(localBusinessJsonLd) }],
  }),
  component: Home,
});

const TRUST = [
  { icon: MapPin, title: "Local to Homestead", text: "Miami-Dade & Broward" },
  { icon: CloudLightning, title: "Storm-ready", text: "Built for hurricane season" },
  { icon: Languages, title: "Hablamos español", text: "Bilingual crew & office" },
  { icon: ShieldCheck, title: "Free estimates", text: "Honest, written quotes" },
];

function Home() {
  const { data: content } = useSuspenseQuery(siteContentQuery);
  return (
    <>
      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-navy text-navy-foreground">
        <img
          src={heroImg}
          alt="Drone aerial view of a new charcoal standing seam metal roof on a Homestead, Florida home"
          width={1920}
          height={1088}
          fetchPriority="high"
          className="animate-kenburns absolute inset-0 -z-10 size-full object-cover"
        />
        <div className="bg-gradient-hero absolute inset-0 -z-10" />
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-16 sm:px-6 md:pb-24 md:pt-24 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
          <div>
            <p className="eyebrow animate-fade-up inline-flex items-center gap-2 rounded-full border border-navy-foreground/20 bg-navy-foreground/10 px-3 py-1.5 text-navy-foreground backdrop-blur">
              <Star className="size-3.5 fill-star text-star" /> Homestead's roofing masters
            </p>
            <h1 className="animate-fade-up mt-5 text-[2.6rem] font-black leading-[0.98] sm:text-6xl lg:text-7xl" style={{ animationDelay: "80ms" }}>
              {content.hero_headline}
            </h1>
            <p className="animate-fade-up mt-5 max-w-xl text-lg leading-relaxed text-navy-foreground/85" style={{ animationDelay: "160ms" }}>
              {content.hero_subheadline}
            </p>
            <div className="animate-fade-up mt-8 grid gap-3 sm:flex sm:flex-wrap" style={{ animationDelay: "240ms" }}>
              <Button asChild variant="hero" size="xl">
                <a href={BUSINESS.phoneHref}>
                  <Phone /> Call {BUSINESS.phoneDisplay}
                </a>
              </Button>
              <Button asChild variant="whatsapp" size="xl">
                <a href={BUSINESS.whatsappHref} target="_blank" rel="noopener noreferrer">
                  <WhatsAppIcon /> WhatsApp us
                </a>
              </Button>
              <Button asChild variant="light" size="xl"><Link to="/instant-estimator">Instant roof estimate <ArrowRight /></Link></Button>
            </div>
            <ul className="animate-fade-up mt-10 hidden grid-cols-2 gap-4 sm:grid" style={{ animationDelay: "320ms" }}>
              {TRUST.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-navy-foreground/10 backdrop-blur">
                    <Icon className="size-5 text-primary-glow" />
                  </span>
                  <span>
                    <span className="block text-sm font-bold">{title}</span>
                    <span className="block text-xs text-navy-foreground/70">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
            <LeadForm
              source="callback"
              title="Request a Call Back"
              subtitle="Free estimate · We'll call you to talk about your roof."
              compact
            />
          </div>
        </div>
      </section>

      {/* TRUST STRIP (mobile) */}
      <section className="border-b border-border bg-card sm:hidden">
        <ul className="grid grid-cols-2 gap-4 px-4 py-6">
          {TRUST.map(({ icon: Icon, title }) => (
            <li key={title} className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Icon className="size-5 shrink-0 text-primary" /> {title}
            </li>
          ))}
        </ul>
      </section>

      {/* SERVICES */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading eyebrow="What we do" title="Roofing services for every South Florida home">
            From metal roof installation in Homestead to roof replacement across Miami-Dade and
            Broward, one local crew handles it all.
          </SectionHeading>
          <Button asChild variant="outline" size="lg" className="self-start md:self-auto">
            <Link to="/services">
              All services <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((s, i) => (
            <Reveal key={s.slug} delay={(i % 4) * 80} className={i === 0 ? "sm:col-span-2 lg:row-span-2" : ""}>
              <Link
                to="/services"
                hash={s.slug}
                className="group relative block h-full min-h-64 overflow-hidden rounded-2xl bg-navy shadow-card"
              >
                <img src={s.image} alt={`${s.name} by Roofer Masters`} loading="lazy" className="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-105" />
                <div className="bg-gradient-fade-bottom absolute inset-0" />
                <div className="relative flex h-full flex-col justify-end p-6 text-navy-foreground">
                  <h3 className={i === 0 ? "text-3xl font-black sm:text-4xl" : "text-xl font-extrabold"}>{s.name}</h3>
                  <p className="mt-2 text-sm text-navy-foreground/80">{s.short}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary-glow">
                    Learn more <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* BEFORE / AFTER */}
      <section className="bg-gradient-navy py-20 text-navy-foreground md:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHeading light eyebrow="The Roofer Masters difference" title="Drag to see the transformation">
            Real South Florida roofs, before and after our crew. Slide to compare.
          </SectionHeading>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <Reveal>
              <BeforeAfter before={beforeMetal} after={heroImg} alt="storm-damaged tile roof replaced with standing seam metal" caption="Tile to standing seam metal · Homestead" />
            </Reveal>
            <Reveal delay={120}>
              <BeforeAfter before={beforeShingle} after={shingleImg} alt="worn shingle roof replaced with new architectural shingles" caption="Full shingle replacement · Kendall" />
            </Reveal>
          </div>
          <div className="mt-10 text-center">
            <Button asChild variant="light" size="xl">
              <Link to="/gallery">
                See our work <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* WHY US */}
      <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-2">
        <Reveal className="relative">
          <img src={crewImg} alt="The Roofer Masters crew in front of a finished metal roof" loading="lazy" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-elegant" />
          <div className="absolute -bottom-6 right-4 rounded-2xl bg-card p-5 shadow-elegant sm:right-8">
            <p className="font-display text-3xl font-black text-primary">Hablamos</p>
            <p className="font-display text-3xl font-black text-foreground">español</p>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <SectionHeading eyebrow="Why homeowners choose us" title="Craftsmanship you can see from the street">
            We're a local crew from Homestead, not a call center. Every roof gets premium materials,
            code-compliant installation for Miami-Dade's high-velocity hurricane zone, and the care
            we'd give our own homes.
          </SectionHeading>
          <ul className="mt-8 grid gap-4">
            {[
              { icon: Hammer, t: "Master-level installs", d: "Clean lines, sealed details and tidy job sites every single day." },
              { icon: CloudLightning, t: "Built for South Florida weather", d: "Systems designed for heat, heavy rain and hurricane-force winds." },
              { icon: ShieldCheck, t: "Clear, honest estimates", d: "Written quotes and straight answers — no pressure, no surprises." },
            ].map(({ icon: Icon, t, d }) => (
              <li key={t} className="flex gap-4 rounded-2xl border border-border bg-card p-4 shadow-card">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                  <Icon className="size-6" />
                </span>
                <span>
                  <span className="block font-display text-lg font-extrabold text-foreground">{t}</span>
                  <span className="block text-sm text-muted-foreground">{d}</span>
                </span>
              </li>
            ))}
          </ul>
          <Button asChild variant="link" className="mt-4 px-0 text-base font-bold">
            <Link to="/about">
              Our story <ArrowRight />
            </Link>
          </Button>
        </Reveal>
      </section>

      {/* REVIEWS */}
      <section className="bg-muted/60 py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading eyebrow="5-star Google reviews" title="What our neighbors say" />
            <div className="flex items-center gap-3">
              <Stars className="size-6" />
              <Link to="/reviews" className="font-bold text-primary">
                Read more reviews →
              </Link>
            </div>
          </div>
          <div className="no-scrollbar -mx-4 mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
            {REVIEWS.slice(0, 3).map((r, i) => (
              <Reveal key={r.name} delay={i * 100} className="w-[85%] shrink-0 snap-center md:w-auto">
                <ReviewCard review={r} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* AREAS MARQUEE */}
      <section className="overflow-hidden border-y border-border bg-card py-12">
        <div className="mx-auto mb-6 max-w-7xl px-4 sm:px-6">
          <p className="eyebrow text-primary">Proudly serving Miami-Dade &amp; Broward</p>
        </div>
        <div className="flex w-max animate-marquee gap-3">
          {[...AREAS.flatMap((a) => a.cities), ...AREAS.flatMap((a) => a.cities)].map((c, i) => (
            <span key={`${c}-${i}`} className="whitespace-nowrap rounded-full border border-border bg-background px-5 py-2.5 font-display text-lg font-bold text-foreground">
              {c}
            </span>
          ))}
        </div>
        <div className="mx-auto mt-6 max-w-7xl px-4 sm:px-6">
          <Link to="/service-areas" className="font-bold text-primary">
            View all service areas →
          </Link>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
