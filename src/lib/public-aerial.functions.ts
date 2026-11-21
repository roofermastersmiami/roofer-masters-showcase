import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
import { aerialBox, AERIAL_CREDIT } from './public-aerial';

// Free, keyless public sources only: US Census geocoder + USGS National Map imagery (public domain).
export const loadPublicAerial = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ address: z.string().trim().min(8).max(250), spanMeters: z.number().min(30).max(200).default(70) }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: owner } = await context.supabase.rpc('has_any_role',{_user_id:context.userId,_roles:['office','sales','production_manager']});
    if (!owner) throw new Error('You do not have access to this action');
    const geo = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(data.address)}&benchmark=Public_AR_Current&format=json`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!geo?.ok) return { error: 'Free address lookup is unavailable right now. Upload your own drone or roof photo instead.' } as const;
    const match = (await geo.json() as { result?: { addressMatches?: { coordinates: { x: number; y: number }; matchedAddress: string }[] } }).result?.addressMatches?.[0];
    if (!match) return { error: 'Address not found by the free US Census lookup. Check the address or upload your own photo.' } as const;
    const box = aerialBox(match.coordinates.y, match.coordinates.x, data.spanMeters, 1000);
    const img = await fetch(`https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export?bbox=${box.bbox.join(',')}&bboxSR=3857&imageSR=3857&size=1000,1000&format=png&f=image`, { signal: AbortSignal.timeout(25000) }).catch(() => null);
    if (!img?.ok || !img.headers.get('content-type')?.startsWith('image/')) return { error: 'Free public aerial imagery is unavailable for this spot right now. Upload your own photo instead.' } as const;
    const bytes = new Uint8Array(await img.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { image: `data:image/png;base64,${btoa(bin)}`, feetPerPixel: box.feetPerPixel, matchedAddress: match.matchedAddress, lat: match.coordinates.y, lon: match.coordinates.x, credit: AERIAL_CREDIT } as const;
  });
