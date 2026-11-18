import { Link } from "@tanstack/react-router";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BUSINESS } from "@/lib/site";
import { WhatsAppIcon } from "./SocialIcons";
import { Reveal } from "./Reveal";

export function CtaBand({ title = "Ready for a roof built to last?" }: { title?: string }) {
  return (
    <section className="px-4 py-16 sm:px-6 md:py-24">
      <Reveal className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-navy px-6 py-14 text-center text-navy-foreground shadow-elegant sm:px-12 md:py-20">
        <div className="grid-lines pointer-events-none absolute inset-0" />
        <div className="relative">
          <p className="eyebrow text-primary-glow">Free estimates · Hablamos español</p>
          <h2 className="mx-auto mt-4 max-w-3xl text-3xl font-black leading-tight sm:text-5xl">{title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-navy-foreground/75">
            Talk to a local roofing pro today. We serve Homestead, Miami, Fort Lauderdale and every
            city in between.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild variant="light" size="xl">
              <a href={BUSINESS.phoneHref}>
                <Phone /> Call {BUSINESS.phoneDisplay}
              </a>
            </Button>
            <Button asChild variant="whatsapp" size="xl">
              <a href={BUSINESS.whatsappHref} target="_blank" rel="noopener noreferrer">
                <WhatsAppIcon /> Chat on WhatsApp
              </a>
            </Button>
            <Button asChild variant="outlineLight" size="xl">
              <Link to="/contact">Request a quote</Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
