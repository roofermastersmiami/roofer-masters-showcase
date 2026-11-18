import { Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Menu, Phone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { BUSINESS, NAV } from "@/lib/site";
import { siteContentQuery } from "@/lib/content.functions";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const { data: content } = useSuspenseQuery(siteContentQuery);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {content.announcement && (
        <div className="bg-navy px-4 py-2 text-center text-xs font-semibold tracking-wide text-navy-foreground sm:text-sm">
          {content.announcement}
        </div>
      )}
      <header
        className={cn(
          "sticky top-0 z-50 border-b transition-all duration-300",
          scrolled
            ? "border-border bg-card/90 shadow-card backdrop-blur-xl"
            : "border-transparent bg-card",
        )}
      >
        <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:h-20">
          <Logo priority className="h-12 lg:h-14" />

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-foreground/75 transition hover:bg-accent hover:text-accent-foreground"
                activeProps={{ className: "text-primary bg-accent" }}
                activeOptions={{ exact: true }}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="call" size="lg" className="hidden h-11 rounded-xl sm:inline-flex">
              <a href={BUSINESS.phoneHref}>
                <Phone /> {BUSINESS.phoneDisplay}
              </a>
            </Button>
            <Button asChild variant="call" size="icon" className="size-11 rounded-xl sm:hidden">
              <a href={BUSINESS.phoneHref} aria-label={`Call ${BUSINESS.phoneDisplay}`}>
                <Phone className="!size-5" />
              </a>
            </Button>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="grid size-11 place-items-center rounded-xl border border-border text-foreground lg:hidden"
            >
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="animate-fade-up fixed inset-x-0 bottom-0 top-[4.5rem] z-40 overflow-y-auto bg-card px-4 pb-32 pt-4 lg:hidden">
            <nav aria-label="Mobile" className="flex flex-col">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className="border-b border-border py-4 font-display text-2xl font-extrabold text-foreground"
                  activeProps={{ className: "text-primary" }}
                  activeOptions={{ exact: true }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-6 grid gap-3">
              <Button asChild variant="call" size="tap">
                <a href={BUSINESS.phoneHref}>
                  <Phone /> Call {BUSINESS.phoneDisplay}
                </a>
              </Button>
              <Button asChild variant="outline" size="tap">
                <Link to="/contact" onClick={() => setOpen(false)}>
                  Request a free estimate
                </Link>
              </Button>
              <p className="pt-2 text-center text-sm font-semibold text-muted-foreground">
                Hablamos español
              </p>
            </div>
          </div>
        )}
      </header>
    </>
  );
}
