# Roofer Masters own roof measurement system: completion plan

No paid measurement provider will be used at any step: no EagleView, Roofr, GAF QuickMeasure, HOVER, no per-report charge, and no billing account.

## Already built and tested
- Create a report from a property address, linked to the customer and property.
- Upload aerial, drone or roof photos.
- Calibrate scale with two clicks and a known distance, then trace roof planes.
- 3D roof view showing area, pitch, edges and penetrations.
- Saved versions, a branded report PDF with photos, and a review gate.
- Reviewed measurements transfer to the estimator and materials.
- A drawing and its report always save together in one step.

## Free imagery and address sources to check (no paid API)
| Source | What it gives | Limits |
|---|---|---|
| US Census Geocoder | Address to map coordinates, free, public | US only; sometimes lands on the street, not the roof |
| USGS / NAIP aerial photos (The National Map) | Free public-domain aerial photos | Too coarse to see roof edges well (about 0.6 to 1 m per pixel); usable only as a rough outline |
| Miami-Dade and Broward county aerial photo services | Sharper aerial photos | Free to view; terms and download rights must be confirmed before use. Nothing gets turned on until that is confirmed |
| USGS 3DEP LiDAR (laser height data) | Free public-domain heights; can suggest pitch | Coverage and age vary; heavy files; pitch is suggested only, never automatic |
| OpenStreetMap building outlines | Free building footprints | Outline only, may be missing, credit to OpenStreetMap required, light use only |

Commercial map services (Google, Esri, Mapbox) need accounts or billing, or have terms that forbid this use, so they will not be added.

**Honest limit:** there is no free source that turns an address into accurate roof measurements by itself. The free baseline is your own drone or ground photos plus a known measurement, or a tape-measured dimension, plus a pitch gauge reading.

## Phases (each one tested before the next)
1. **Free address lookup:**
   - Turn the address into map coordinates using the free Census lookup.
   - Show where the property is. If the lookup fails, the report still works by hand.
2. **Bring in imagery:**
   - Upload drone or phone photos as today.
   - Add an optional "load public aerial photo" button using free public-domain photos, with clear credit and an "estimated" label.
   - County photo layers stay off until their terms are confirmed.
3. **Better tracing:**
   - Several roof planes from one photo.
   - Drag corners and snap to shared edges.
   - Mark each line as ridge, hip, valley, eave, rake or wall.
   - Set pitch per plane, with an optional suggestion from laser height data where it is available.
4. **Clear accuracy labels:**
   - Each measurement is labeled "Estimated from photo", "Scaled from a known distance" or "Verified on site".
   - The PDF and the estimator show these labels.
   - Nothing is ever called survey-grade.
5. **Report PDF and transfer, part 2:**
   - Branded cover page, roof diagram with edge lengths, waste table, material takeoff, image credits.
   - Only reviewed reports can transfer to the estimator.
6. **Rest of the CRM** (continued without per-step approval):
   - Production stages and daily logs.
   - Calendar.
   - Estimate approval in the customer portal.
   - Progress invoices.
   - Inventory and suppliers.
   - Automation rules for tasks and alerts.

## Will pause only for
- **Team roles:** you haven't confirmed roles yet. Until you do, the CRM stays owner-only and team roles are skipped.
- **County aerial photos:** using them needs their terms confirmed.
- **Outside services:** email sending domain, live payments activation, phone/SMS service.

## Technical notes
- Address lookup and public map tile requests run on the server, with request caching and rate limits. Only free, keyless public services are used.
- Image credit and the accuracy label are saved with each drawing version. Existing records are untouched.
- Each phase ends with tests, a build check and a signed-in browser run on a QA record. The QA record is removed afterward.
