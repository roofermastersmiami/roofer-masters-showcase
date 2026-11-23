import { createFileRoute } from "@tanstack/react-router";
import heroImg from "@/assets/hero-metal-roof.webp";
import { PageHero } from "@/components/site/PageHero";
import { Reveal } from "@/components/site/Reveal";
import { CtaBand } from "@/components/site/CtaBand";
import { GoogleG, ReviewCard, Stars } from "@/components/site/ReviewCard";
import { Button } from "@/components/ui/button";
import { REVIEWS } from "@/lib/reviews";
import { pageMeta } from "@/lib/seo";

const GOOGLE_REVIEWS_URL = "https://www.google.com/search?q=Roofer+Masters+Homestead+FL+reviews";

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: pageMeta(
      "Reviews | 5-Star Roofer in Miami-Dade & Broward | Roofer Masters",
      "Read what South Florida homeowners say about Roofer Masters, the Homestead roofing company trusted for metal, tile, shingle and flat roofs.",
    ),
  }),
  component: ReviewsPage,
});

function ReviewsPage() {
  return (
    <>
      <PageHero eyebrow="Reviews" title="5-star roofs. 5-star reviews." image={heroImg}>
        Hear from homeowners across Miami-Dade and Broward who trusted us with their roofs.
      </PageHero>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal className="mx-auto flex max-w-3xl flex-col items-center gap-4 rounded-3xl border border-border bg-card p-8 text-center shadow-elegant sm:flex-row sm:text-left">
          <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-muted">
            <GoogleG className="size-9" />
          </div>
          <div className="flex-1">
            <p className="font-display text-2xl font-black text-foreground">Google Reviews</p>
            <div className="mt-1 flex items-center justify-center gap-2 sm:justify-start">
              <Stars className="size-5" />
              <span className="text-sm font-semibold text-muted-foreground">
                5-star rated service
              </span>
            </div>
          </div>
          <Button asChild variant="hero" size="lg">
            <a href={GOOGLE_REVIEWS_URL} target="_blank" rel="noopener noreferrer">
              See us on Google
            </a>
          </Button>
        </Reveal>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {REVIEWS.map((r, i) => (
            <Reveal key={r.name} delay={(i % 3) * 90}>
              <ReviewCard review={r} />
            </Reveal>
          ))}
        </div>
      </section>

      <CtaBand title="Join our list of happy homeowners" />
    </>
  );
}
