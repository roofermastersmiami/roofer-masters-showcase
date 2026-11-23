import metalImg from "@/assets/service-metal.webp";
import tileImg from "@/assets/service-tile.webp";
import shingleImg from "@/assets/service-shingle.webp";
import flatImg from "@/assets/service-flat.webp";
import replacementImg from "@/assets/service-replacement.webp";
import repairsImg from "@/assets/service-repairs.webp";
import guttersImg from "@/assets/service-gutters.webp";

export const BUSINESS = {
  name: "Roofer Masters",
  tagline: "Your Roof, Our Masterpiece",
  phoneDisplay: "305-942-3093",
  phoneHref: "tel:+13059423093",
  phoneE164: "+13059423093",
  email: "roofermasters@gmail.com",
  whatsappHref:
    "https://wa.me/13059423093?text=" +
    encodeURIComponent("Hi Roofer Masters! I'd like a roofing estimate."),
  baseCity: "Homestead, FL",
  counties: ["Miami-Dade", "Broward"],
  hours: [
    { days: "Monday – Friday", time: "8:00 AM – 5:00 PM" },
    { days: "Saturday", time: "10:00 AM – 1:00 PM" },
    { days: "Sunday", time: "Closed" },
  ],
  socials: {
    instagram: "https://www.instagram.com/roofermasters/",
    facebook: "https://www.facebook.com/people/Roofer-Masters/61582342154995/",
    tiktok: "https://www.tiktok.com/@roofermasters",
  },
} as const;

export const NAV = [
  { to: "/", label: "Home" },
  { to: "/services", label: "Services" },
  { to: "/gallery", label: "Our Work" },
  { to: "/about", label: "About" },
  { to: "/reviews", label: "Reviews" },
  { to: "/service-areas", label: "Areas" },
  { to: "/contact", label: "Contact" },
] as const;

export type Service = {
  slug: string;
  name: string;
  short: string;
  image: string;
  description: string;
  benefits: string[];
};

export const SERVICES: Service[] = [
  {
    slug: "metal-roofing",
    name: "Metal Roofing",
    short: "Standing seam & 5V crimp systems built for 175+ mph winds.",
    image: metalImg,
    description:
      "Our most requested upgrade. We install standing seam and 5V crimp metal roofs engineered to Miami-Dade HVHZ code, with concealed fasteners, high-temp underlayment and reflective finishes that cut cooling costs through brutal Florida summers. Metal roof installation in Homestead and across South Florida is our specialty.",
    benefits: [
      "Rated for hurricane-force winds",
      "40–70 year lifespan",
      "Reflective coatings lower AC bills",
      "Possible insurance premium savings",
    ],
  },
  {
    slug: "tile-roofing",
    name: "Tile Roofing",
    short: "Concrete & clay tile installed to Miami-Dade HVHZ code.",
    image: tileImg,
    description:
      "The classic South Florida look, done right. We install barrel, flat and S-tile in concrete or clay with foam-set or mechanically fastened attachment, double-layer underlayment and properly flashed valleys so your tile roof stays beautiful and watertight for decades.",
    benefits: [
      "Timeless Mediterranean curb appeal",
      "Excellent heat resistance",
      "Foam-set for wind uplift strength",
      "50+ year tile life",
    ],
  },
  {
    slug: "shingle-roofing",
    name: "Shingle Roofing",
    short: "High-wind architectural shingles with enhanced nailing.",
    image: shingleImg,
    description:
      "Architectural shingles are a smart, budget-friendly choice when installed with South Florida in mind. We use high-wind rated shingles, six-nail patterns, sealed roof decks and algae-resistant granules to keep your home protected and looking sharp.",
    benefits: [
      "Most affordable full roof system",
      "High-wind rated products",
      "Algae-resistant colors",
      "Fast installation, minimal disruption",
    ],
  },
  {
    slug: "flat-roofing",
    name: "Flat Roofing (TPO & Hot Mop)",
    short: "TPO membranes and hot mop built-up systems for low slopes.",
    image: flatImg,
    description:
      "For homes, additions and commercial buildings with low-slope roofs, we install heat-welded white TPO membranes and traditional hot mop built-up roofing. Proper tapered insulation and drainage keep water moving off your roof, not into your building.",
    benefits: [
      "Heat-welded, watertight seams",
      "Energy-saving white TPO",
      "Proven hot mop for durability",
      "Residential & commercial",
    ],
  },
  {
    slug: "roof-replacement",
    name: "Roof Replacement",
    short: "Full tear-off, deck repair, permits and final inspection.",
    image: replacementImg,
    description:
      "When it's time for a new roof, we handle everything: permits, full tear-off down to the deck, wood replacement, secondary water barrier, new roof system and city inspections. Roof replacement in Miami-Dade and Broward with clean job sites and clear communication from start to finish.",
    benefits: [
      "We pull all permits",
      "Rotten wood replaced",
      "Daily job-site cleanup",
      "Wind mitigation ready",
    ],
  },
  {
    slug: "roof-repairs",
    name: "Roof Repairs",
    short: "Leaks, storm damage, broken tile and emergency tarping.",
    image: repairsImg,
    description:
      "Leaks don't wait, and neither do we. From a few broken tiles to storm and hurricane damage, our repair crews find the source, fix it properly and document everything for your insurance claim when needed.",
    benefits: [
      "Fast response across both counties",
      "Leak detection & storm damage",
      "Emergency tarping",
      "Photo reports for insurance",
    ],
  },
  {
    slug: "gutters",
    name: "Gutters",
    short: "Seamless aluminum gutters & downspouts sized for tropical rain.",
    image: guttersImg,
    description:
      "South Florida downpours dump serious water. We custom-form seamless aluminum gutters on site and size downspouts to move heavy rainfall away from your roof edge, walls and foundation.",
    benefits: [
      "Seamless, custom-formed on site",
      "Oversized downspouts available",
      "Protects fascia & foundation",
      "Color-matched to your home",
    ],
  },
];

export const SERVICE_OPTIONS = [
  ...SERVICES.map((s) => s.name),
  "Free Roof Inspection",
  "Other / Not sure",
];

export const AREAS: { county: "Miami-Dade" | "Broward"; cities: string[] }[] = [
  {
    county: "Miami-Dade",
    cities: [
      "Homestead",
      "Florida City",
      "Kendall",
      "Cutler Bay",
      "Palmetto Bay",
      "Pinecrest",
      "Miami",
      "Coral Gables",
      "South Miami",
      "Doral",
      "Hialeah",
      "Miami Lakes",
      "Miami Gardens",
      "North Miami",
      "Aventura",
      "Miami Beach",
      "Westchester",
      "Redland",
    ],
  },
  {
    county: "Broward",
    cities: [
      "Fort Lauderdale",
      "Hollywood",
      "Pembroke Pines",
      "Miramar",
      "Davie",
      "Weston",
      "Plantation",
      "Sunrise",
      "Coral Springs",
      "Pompano Beach",
      "Hallandale Beach",
      "Cooper City",
    ],
  },
];
