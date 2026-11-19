import { createFileRoute } from "@tanstack/react-router";
import { CloudLightning, Gem, HeartHandshake, Languages, MapPin, Hammer } from "lucide-react";
import crewImg from "@/assets/about-crew.webp";
import metalImg from "@/assets/service-metal.webp";
import heroImg from "@/assets/gallery-drone-tile.webp";
import { PageHero, SectionHeading } from "@/components/site/PageHero";
import { Reveal } from "@/components/site/Reveal";
import { CtaBand } from "@/components/site/CtaBand";
import { Logo } from "@/components/site/Logo";
import { pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: pageMeta(
      "About Roofer Masters | Local Homestead Roofing Company · Hablamos Español",
      "Meet Roofer Masters, a locally owned roofing company in Homestead, Florida building storm-ready roofs across Miami-Dade and Broward with quality materials and true craftsmanship.",
    ),
  }),
  component: AboutPage,
});

const VALUES = [
  { icon: Hammer, title: "Craftsmanship", text: "Every seam, flashing and ridge is installed like it's going on our own home." },
  { icon: Gem, title: "Quality materials", text: "Premium metal panels, tile, shingles, membranes and underlayments from trusted manufacturers." },
  { icon: CloudLightning, title: "Storm-ready", text: "Roof systems built for Miami-Dade's high-velocity hurricane zone, heat and heavy rain." },
  { icon: HeartHandshake, title: "Straight talk", text: "Honest assessments, written estimates and clear communication from day one." },
];

function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About us" title={<>Local roofers. <span className="text-gradient-primary">Master-level work.</span></>} image={heroImg}>
        Born and built in Homestead, Florida, serving neighbors across Miami-Dade and Broward.
      </PageHero>

      <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 md:py-28 lg:grid-cols-2">
        <Reveal>
          <SectionHeading eyebrow="Our story" title="Your roof, our masterpiece" />
          <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
            <p>
              Roofer Masters started with a simple idea: South Florida homeowners deserve a roofer who
              shows up, does it right and stands behind the work. We're based in Homestead, and we've
              built our name one roof at a time across Miami-Dade and Broward.
            </p>
            <p>
              Down here, a roof isn't just a roof. It's what stands between your family and summer
              storms, tropical downpours and hurricane season. That's why every system we install is
              built for South Florida weather, using quality materials and installation details that
              meet the region's strict building codes.
            </p>
            <p>
              Whether it's a standing seam metal roof in Homestead, a tile roof in Coral Gables or a
              TPO flat roof in Doral, we treat every project like a masterpiece, because to us, it is.
            </p>
          </div>
        </Reveal>
        <Reveal delay={120} className="relative">
          <img src={crewImg} alt="Roofer Masters roofing crew" loading="lazy" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-elegant" />
          <img src={metalImg} alt="Close-up of metal roof seaming" loading="lazy" className="absolute -bottom-10 -left-4 hidden aspect-square w-44 rounded-2xl border-4 border-card object-cover shadow-elegant sm:block" />
        </Reveal>
      </section>

      <section className="bg-gradient-navy py-20 text-navy-foreground md:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <SectionHeading light align="center" eyebrow="What we stand for" title="Built different. Built to last." />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map(({ icon: Icon, title, text }, i) => (
              <Reveal key={title} delay={i * 90} className="rounded-2xl border border-navy-foreground/10 bg-navy-foreground/5 p-6 backdrop-blur">
                <Icon className="size-9 text-primary-glow" />
                <h3 className="mt-4 text-xl font-extrabold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-navy-foreground/75">{text}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-20 sm:px-6 md:grid-cols-2 md:py-28">
        <Reveal className="rounded-3xl border border-border bg-card p-8 shadow-card sm:p-10">
          <Languages className="size-10 text-primary" />
          <h2 className="mt-4 text-4xl font-black text-foreground sm:text-5xl">Hablamos español</h2>
          <p className="mt-4 text-muted-foreground sm:text-lg">
            Nuestro equipo habla inglés y español. Llámenos o escríbanos por WhatsApp para una
            inspección y un presupuesto gratis. Our bilingual team makes every step easy.
          </p>
        </Reveal>
        <Reveal delay={100} className="rounded-3xl border border-border bg-card p-8 shadow-card sm:p-10">
          <MapPin className="size-10 text-primary" />
          <h2 className="mt-4 text-4xl font-black text-foreground sm:text-5xl">Truly local</h2>
          <p className="mt-4 text-muted-foreground sm:text-lg">
            From Homestead and Kendall to Hialeah, Fort Lauderdale and Pembroke Pines, we live and
            work here. We know the codes, the weather and the neighborhoods.
          </p>
          <div className="mt-6">
            <Logo className="h-20" />
          </div>
        </Reveal>
      </section>

      <CtaBand />
    </>
  );
}
