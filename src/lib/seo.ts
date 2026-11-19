import { AREAS, BUSINESS, SERVICES } from "./site";

export function pageMeta(title: string, description: string) {
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

export const localBusinessJsonLd = {
  "@context": "https://schema.org",
  "@type": "RoofingContractor",
  name: BUSINESS.name,
  slogan: BUSINESS.tagline,
  telephone: BUSINESS.phoneE164,
  email: BUSINESS.email,
  address: {
    "@type": "PostalAddress",
    addressLocality: "Homestead",
    addressRegion: "FL",
    addressCountry: "US",
  },
  areaServed: [
    { "@type": "AdministrativeArea", name: "Miami-Dade County, FL" },
    { "@type": "AdministrativeArea", name: "Broward County, FL" },
    ...AREAS.flatMap((a) => a.cities).map((c) => ({ "@type": "City", name: `${c}, FL` })),
  ],
  knowsLanguage: ["en", "es"],
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      opens: "08:00",
      closes: "17:00",
    },
    { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "10:00", closes: "13:00" },
  ],
  sameAs: Object.values(BUSINESS.socials),
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Roofing services",
    itemListElement: SERVICES.map((s) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: s.name, description: s.short },
    })),
  },
};
