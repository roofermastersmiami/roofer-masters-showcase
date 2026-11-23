import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play, X } from "lucide-react";
import heroImg from "@/assets/hero-metal-roof.webp";
import beforeMetal from "@/assets/before-metal.webp";
import beforeShingle from "@/assets/before-shingle.webp";
import droneTile from "@/assets/gallery-drone-tile.webp";
import crewImg from "@/assets/about-crew.webp";
import reelImg from "@/assets/reel-underlayment.webp";
import metalImg from "@/assets/service-metal.webp";
import tileImg from "@/assets/service-tile.webp";
import shingleImg from "@/assets/service-shingle.webp";
import flatImg from "@/assets/service-flat.webp";
import replacementImg from "@/assets/service-replacement.webp";
import repairsImg from "@/assets/service-repairs.webp";
import guttersImg from "@/assets/service-gutters.webp";
import { PageHero, SectionHeading } from "@/components/site/PageHero";
import { Reveal } from "@/components/site/Reveal";
import { BeforeAfter } from "@/components/site/BeforeAfter";
import { CtaBand } from "@/components/site/CtaBand";
import { InstagramIcon, SocialLinks, TikTokIcon } from "@/components/site/SocialIcons";
import { BUSINESS } from "@/lib/site";
import { pageMeta } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/gallery")({
  head: () => ({
    meta: pageMeta(
      "Our Work | Roofing Project Gallery Miami-Dade & Broward | Roofer Masters",
      "Drone shots of finished roofs, before-and-after transformations, tear-offs and installations from Roofer Masters projects across Homestead, Miami and Broward County.",
    ),
  }),
  component: GalleryPage,
});

type Cat = "All" | "Drone shots" | "Finished roofs" | "Tear-offs" | "Installations";
const CATS: Cat[] = ["All", "Drone shots", "Finished roofs", "Tear-offs", "Installations"];

const PHOTOS: {
  src: string;
  alt: string;
  cat: Exclude<Cat, "All">;
  tall?: boolean;
  wide?: boolean;
}[] = [
  {
    src: heroImg,
    alt: "Drone view of a charcoal standing seam metal roof in Homestead",
    cat: "Drone shots",
    wide: true,
  },
  {
    src: droneTile,
    alt: "Top-down drone shot of a white flat roof in Coral Gables",
    cat: "Drone shots",
  },
  { src: replacementImg, alt: "Crew tearing off an old shingle roof", cat: "Tear-offs" },
  {
    src: reelImg,
    alt: "Installing self-adhered underlayment on a Miami roof",
    cat: "Installations",
    tall: true,
  },
  { src: tileImg, alt: "New concrete barrel tile roof", cat: "Finished roofs" },
  { src: metalImg, alt: "Seaming standing seam metal panels", cat: "Installations" },
  { src: flatImg, alt: "Drone shot of a white TPO commercial roof in Doral", cat: "Drone shots" },
  {
    src: shingleImg,
    alt: "Finished architectural shingle roof in Kendall",
    cat: "Finished roofs",
    wide: true,
  },
  { src: repairsImg, alt: "Repairing storm-damaged roof tiles", cat: "Tear-offs" },
  { src: guttersImg, alt: "New seamless white gutters and downspout", cat: "Finished roofs" },
  { src: crewImg, alt: "The Roofer Masters crew at a finished job", cat: "Finished roofs" },
];

const REELS = [
  { poster: reelImg, title: "Dry-in day: underlayment going down", platform: "instagram" as const },
  { poster: metalImg, title: "Seaming a standing seam metal roof", platform: "tiktok" as const },
  { poster: replacementImg, title: "Full tear-off in under a day", platform: "instagram" as const },
  { poster: droneTile, title: "Drone reveal: finished flat roof", platform: "tiktok" as const },
];

function GalleryPage() {
  const [cat, setCat] = useState<Cat>("All");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const photos = PHOTOS.filter((p) => cat === "All" || p.cat === cat);

  return (
    <>
      <PageHero eyebrow="Our work" title="Roofs we're proud to put our name on" image={droneTile}>
        Job photos, drone shots and behind-the-scenes from @roofermasters on Instagram, Facebook and
        TikTok.
      </PageHero>

      {/* Before & after */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24">
        <SectionHeading eyebrow="Before & after" title="Slide to see the difference" />
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <Reveal>
            <BeforeAfter
              before={beforeMetal}
              after={heroImg}
              alt="tile roof replaced with standing seam metal"
              caption="Storm-damaged tile → standing seam metal · Homestead"
            />
          </Reveal>
          <Reveal delay={120}>
            <BeforeAfter
              before={beforeShingle}
              after={shingleImg}
              alt="old shingle roof replaced with new shingles"
              caption="Worn shingles → high-wind architectural shingles · Kendall"
            />
          </Reveal>
        </div>
      </section>

      {/* Reels */}
      <section className="bg-gradient-navy py-16 text-navy-foreground md:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading light eyebrow="Reels" title="The crew at work">
              Short videos from the job site. Follow @roofermasters for new ones every week.
            </SectionHeading>
            <SocialLinks iconClass="text-navy-foreground" />
          </div>
          <div className="no-scrollbar -mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:px-0">
            {REELS.map((r, i) => {
              const href =
                r.platform === "instagram" ? BUSINESS.socials.instagram : BUSINESS.socials.tiktok;
              const Icon = r.platform === "instagram" ? InstagramIcon : TikTokIcon;
              return (
                <Reveal
                  key={r.title}
                  delay={i * 90}
                  className="w-[62%] shrink-0 snap-center sm:w-[40%] md:w-auto"
                >
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative block aspect-[9/16] overflow-hidden rounded-2xl bg-charcoal shadow-elegant"
                  >
                    <img
                      src={r.poster}
                      alt={r.title}
                      loading="lazy"
                      className="absolute inset-0 size-full object-cover transition duration-700 group-hover:scale-105"
                    />
                    <div className="bg-gradient-fade-bottom absolute inset-0" />
                    <span className="absolute right-3 top-3 grid size-9 place-items-center rounded-full bg-navy/60 backdrop-blur">
                      <Icon className="size-4" />
                    </span>
                    <span className="absolute left-1/2 top-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card/90 text-primary shadow-elegant transition group-hover:scale-110">
                      <Play className="ml-1 size-7 fill-current" />
                    </span>
                    <p className="absolute inset-x-0 bottom-0 p-4 text-sm font-bold">{r.title}</p>
                  </a>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Photo grid */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24">
        <SectionHeading eyebrow="Project photos" title="Real jobs across South Florida" />
        <div className="no-scrollbar -mx-4 mt-8 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {CATS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={cn(
                "h-11 whitespace-nowrap rounded-full border px-5 text-sm font-bold transition",
                cat === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mt-8 grid auto-rows-[200px] grid-cols-2 gap-3 sm:auto-rows-[240px] md:grid-cols-3 md:gap-4">
          {photos.map((p, i) => (
            <button
              key={p.src + p.alt}
              type="button"
              onClick={() => setLightbox(i)}
              className={cn(
                "group relative overflow-hidden rounded-2xl bg-muted shadow-card",
                p.tall && "row-span-2",
                p.wide && "col-span-2",
              )}
            >
              <img
                src={p.src}
                alt={p.alt}
                loading="lazy"
                className="size-full object-cover transition duration-700 group-hover:scale-105"
              />
              <span className="absolute left-3 top-3 rounded-full bg-card/90 px-3 py-1 text-xs font-bold text-primary">
                {p.cat}
              </span>
            </button>
          ))}
        </div>
      </section>

      {lightbox !== null && photos[lightbox] && (
        <div
          role="dialog"
          aria-label="Photo viewer"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/95 p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute right-4 top-4 grid size-12 place-items-center rounded-full bg-card text-foreground"
          >
            <X />
          </button>
          <figure className="max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <img
              src={photos[lightbox].src}
              alt={photos[lightbox].alt}
              className="max-h-[80vh] w-auto rounded-2xl"
            />
            <figcaption className="mt-3 text-center text-sm text-navy-foreground/80">
              {photos[lightbox].alt}
            </figcaption>
          </figure>
        </div>
      )}

      <CtaBand title="Want your roof in our gallery?" />
    </>
  );
}
