import { createFileRoute } from "@tanstack/react-router";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { z } from "zod";
import heroImg from "@/assets/service-gutters.webp";
import { PageHero } from "@/components/site/PageHero";
import { Reveal } from "@/components/site/Reveal";
import { LeadForm } from "@/components/site/LeadForm";
import { ServiceAreaMap } from "@/components/site/ServiceAreaMap";
import { SocialLinks, WhatsAppIcon } from "@/components/site/SocialIcons";
import { Button } from "@/components/ui/button";
import { BUSINESS } from "@/lib/site";
import { pageMeta } from "@/lib/seo";

export const Route = createFileRoute("/contact")({
  validateSearch: z.object({ service: z.string().max(100).optional() }),
  head: () => ({
    meta: pageMeta(
      "Contact Roofer Masters | Free Roofing Estimate Miami-Dade & Broward",
      "Call 305-942-3093, WhatsApp or send a message for a free roofing estimate. Open Mon–Fri 8 AM–5 PM and Sat 10 AM–1 PM. Hablamos español.",
    ),
  }),
  component: ContactPage,
});

function ContactPage() {
  const { service } = Route.useSearch();
  return (
    <>
      <PageHero eyebrow="Contact" title="Let's talk about your roof" image={heroImg}>
        Free estimates across Miami-Dade and Broward. Call, WhatsApp or send us a message.
      </PageHero>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[1.2fr_1fr]">
        <Reveal>
          <LeadForm
            source={service ? "quote" : "contact"}
            title={service ? "Request a quote" : "Send us a message"}
            subtitle="Tell us about your project and we'll get back to you."
            submitLabel={service ? "Request my quote" : "Send message"}
            defaultService={service}
          />
        </Reveal>

        <Reveal delay={100} className="space-y-4">
          <a href={BUSINESS.phoneHref} className="flex items-center gap-4 rounded-2xl bg-gradient-primary p-6 text-primary-foreground shadow-elegant">
            <Phone className="size-8" />
            <span>
              <span className="block text-sm font-semibold opacity-80">Call or text</span>
              <span className="block font-display text-3xl font-black">{BUSINESS.phoneDisplay}</span>
            </span>
          </a>
          <Button asChild variant="whatsapp" size="tap" className="h-16 text-lg">
            <a href={BUSINESS.whatsappHref} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon className="!size-6" /> Chat on WhatsApp
            </a>
          </Button>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
            <a href={`mailto:${BUSINESS.email}`} className="flex items-center gap-3 font-semibold text-foreground">
              <Mail className="size-5 text-primary" /> {BUSINESS.email}
            </a>
            <div className="mt-5 flex gap-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-primary" />
              <dl className="grid flex-1 gap-1.5 text-sm">
                {BUSINESS.hours.map((h) => (
                  <div key={h.days} className="flex justify-between gap-4">
                    <dt className="font-semibold text-foreground">{h.days}</dt>
                    <dd className="text-muted-foreground">{h.time}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="mt-5 flex items-center gap-3 text-sm text-muted-foreground">
              <MapPin className="size-5 text-primary" /> Serving all of Miami-Dade &amp; Broward
            </p>
            <p className="mt-5 font-display text-lg font-extrabold text-foreground">Hablamos español</p>
            <SocialLinks className="mt-4 text-primary" />
          </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <ServiceAreaMap className="h-[420px]" />
      </section>
    </>
  );
}
