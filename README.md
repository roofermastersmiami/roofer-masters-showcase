# Roofer Masters Showcase

## Development progress dashboard

A refreshable visual development tracker is published from `docs/progress/index.html` using the GitHub Actions workflow `.github/workflows/progress-pages.yml`. Enable **Settings → Pages → Build and deployment → Source: GitHub Actions** to publish it at `https://roofermastersmiami.github.io/roofer-masters-showcase/`. The dashboard refreshes its commit feed on demand and the workflow also republishes every 30 minutes. The repository is private, so confirm your GitHub Pages plan and site visibility before sharing the published page publicly.


Build a professional, modern website for Roofer Masters, a roofing company based in Homestead, Florida, serving all of Miami-Dade and Broward counties. The site should feel bold, trustworthy, and high-end, using deep blue, white, and dark gray colors to match the company branding.
Create a 3D version of the company logo — a stylized blue roof over a small window, with the name ROOFER MASTERS in strong bold lettering and the tagline YOUR ROOF, OUR MASTERPIECE. Give the logo depth, shading, and a polished 3D effect, and use it in the header, footer, and loading/intro areas of the site.
Include the following pages and sections:
HOME — A cinematic hero section featuring a drone-style aerial photo of a finished metal roof, a strong headline about quality roofing in Miami-Dade and Broward, and a clear "Request a Call Back" form (name, phone, email, service needed, message) plus a click-to-call button for 305-942-3093 and a WhatsApp chat button.
SERVICES — Separate detailed sections for each service: Metal Roofing, Tile Roofing, Shingle Roofing, Flat Roofing (TPO and hot mop), Roof Replacement, Roof Repairs, and Gutters. Each service should include its own photo, description, and benefits.
OUR WORK / GALLERY — A large gallery inspired by the company's social media content (@roofermasters on Instagram, Facebook, and TikTok): real job photos, before-and-after sliders, drone shots of finished roofs, tear-off and installation photos, and embedded short vertical videos (Reels style) showing the crew at work.
ABOUT US — The story of Roofer Masters, highlighting the local aspect of the company serving Miami-Dade and Broward, with a focus on craftsmanship, quality materials, and storm-ready roofs built for South Florida weather. Include the phrase Hablamos español to make the site bilingual-friendly.
REVIEWS — A testimonials section designed to showcase 5-star Google reviews.
SERVICE AREAS — A section listing the areas served across Miami-Dade and Broward (Homestead, Kendall, Cutler Bay, Miami, Hialeah, Coral Gables, Doral, Fort Lauderdale, Hollywood, Pembroke Pines, and surrounding cities).
CONTACT — Contact form, phone, email, business hours (Mon–Fri 8 AM–5 PM, Sat 10 AM–1 PM), and a map of the service area without showing a street address.
For the backend setup, ensure the built-in Wix CRM is configured to automatically save every form submission (call-back requests, contact forms, quote requests) as a contact/lead in the CRM with the relevant details. Include a lead inbox and a simple pipeline to track each lead's status (New, Contacted, Estimate Sent, Won, Lost). Set up automations for an automatic confirmation email to customers upon form submission and an instant notification to the business email roofermasters@gmail.com for every new lead. Provide a secure login/member area and an owner dashboard for the business owner to manage leads, contacts, form submissions, and site content. Incorporate an online chat/inbox feature to store customer messages in the CRM.
The site should be designed with a mobile-first approach given that most visitors will be on phones, ensuring fast loading times, big tap-to-call buttons on mobile, clean sans-serif fonts, smooth scroll animations, and local SEO throughout with keywords like roofing company Miami, metal roof installation Homestead, roof replacement Miami-Dade, and roofer Broward County.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/a47a6279-5c7c-526e-b0d0-ef270e2fe5c8).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
