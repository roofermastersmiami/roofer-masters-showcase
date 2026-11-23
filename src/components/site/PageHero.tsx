import type { ReactNode } from "react";

export function PageHero({
  eyebrow,
  title,
  children,
  image,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  image: string;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-navy text-navy-foreground">
      <img
        src={image}
        alt=""
        aria-hidden="true"
        className="animate-kenburns absolute inset-0 -z-10 size-full object-cover"
        fetchPriority="high"
      />
      <div className="bg-gradient-hero absolute inset-0 -z-10" />
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-20 sm:px-6 md:pb-24 md:pt-28">
        <p className="eyebrow animate-fade-up text-primary-glow">{eyebrow}</p>
        <h1 className="animate-fade-up mt-4 max-w-3xl text-4xl font-black leading-[1.02] sm:text-5xl md:text-6xl">
          {title}
        </h1>
        {children && (
          <div className="animate-fade-up mt-5 max-w-2xl text-base leading-relaxed text-navy-foreground/85 sm:text-lg">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  children,
  align = "left",
  light = false,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
  align?: "left" | "center";
  light?: boolean;
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className={`eyebrow ${light ? "text-primary-glow" : "text-primary"}`}>{eyebrow}</p>
      <h2
        className={`mt-3 text-3xl font-black leading-tight sm:text-4xl md:text-5xl ${light ? "text-navy-foreground" : "text-foreground"}`}
      >
        {title}
      </h2>
      {children && (
        <p
          className={`mt-4 text-base leading-relaxed sm:text-lg ${light ? "text-navy-foreground/75" : "text-muted-foreground"}`}
        >
          {children}
        </p>
      )}
    </div>
  );
}
