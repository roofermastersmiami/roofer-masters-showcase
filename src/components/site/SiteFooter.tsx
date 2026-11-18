import { Link } from "@tanstack/react-router";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { Logo } from "./Logo";
import { SocialLinks } from "./SocialIcons";
import { AREAS, BUSINESS, NAV, SERVICES } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-gradient-navy pb-28 text-navy-foreground md:pb-0">
      <div className="grid-lines pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto max-w-7xl px-4 pt-16 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr_1fr_1.2fr]">
          <div>
            <div className="inline-block rounded-2xl bg-card p-5 shadow-elegant">
              <Logo className="h-24 sm:h-28" />
            </div>
            <p className="mt-6 max-w-xs text-sm leading-relaxed text-navy-foreground/75">
              Locally owned roofing company in Homestead, Florida. Metal, tile, shingle and flat
              roofs for homes and businesses across Miami-Dade and Broward.
            </p>
            <p className="mt-3 font-display text-lg font-bold">Hablamos español</p>
            <SocialLinks className="mt-6" iconClass="text-navy-foreground" />
          </div>

          <div>
            <h3 className="eyebrow text-navy-foreground/60">Services</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {SERVICES.map((s) => (
                <li key={s.slug}>
                  <Link to="/services" hash={s.slug} className="text-navy-foreground/85 hover:text-navy-foreground">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="eyebrow text-navy-foreground/60">Company</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {NAV.filter((n) => n.to !== "/").map((n) => (
                <li key={n.to}>
                  <Link to={n.to} className="text-navy-foreground/85 hover:text-navy-foreground">
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/auth" className="text-navy-foreground/60 hover:text-navy-foreground">
                  Owner login
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="eyebrow text-navy-foreground/60">Get in touch</h3>
            <ul className="mt-4 space-y-4 text-sm">
              <li>
                <a href={BUSINESS.phoneHref} className="flex items-center gap-3 font-display text-2xl font-extrabold">
                  <Phone className="size-5 text-primary-glow" /> {BUSINESS.phoneDisplay}
                </a>
              </li>
              <li>
                <a href={`mailto:${BUSINESS.email}`} className="flex items-center gap-3 text-navy-foreground/85 hover:text-navy-foreground">
                  <Mail className="size-4 text-primary-glow" /> {BUSINESS.email}
                </a>
              </li>
              <li className="flex items-start gap-3 text-navy-foreground/85">
                <Clock className="mt-0.5 size-4 text-primary-glow" />
                <span>
                  {BUSINESS.hours.map((h) => (
                    <span key={h.days} className="block">
                      {h.days}: {h.time}
                    </span>
                  ))}
                </span>
              </li>
              <li className="flex items-start gap-3 text-navy-foreground/85">
                <MapPin className="mt-0.5 size-4 text-primary-glow" />
                <span>Based in Homestead · Serving all of Miami-Dade &amp; Broward</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 border-t border-navy-foreground/10 py-6">
          <p className="text-xs leading-relaxed text-navy-foreground/55">
            Roofing company Miami · Metal roof installation Homestead · Roof replacement Miami-Dade ·
            Roofer Broward County · {AREAS.flatMap((a) => a.cities).slice(0, 12).join(" · ")}
          </p>
          <div className="mt-4 flex flex-col justify-between gap-2 text-xs text-navy-foreground/55 sm:flex-row">
            <p>© {new Date().getFullYear()} Roofer Masters. All rights reserved.</p>
            <p className="font-display-wide text-[0.65rem] font-bold uppercase">Your roof, our masterpiece</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
