export function ServiceAreaMap({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border bg-muted shadow-card ${className}`}>
      <iframe
        title="Roofer Masters service area: Miami-Dade and Broward counties"
        src="https://maps.google.com/maps?q=Miami-Dade%20and%20Broward%20County%2C%20Florida&t=&z=9&ie=UTF8&iwloc=&output=embed"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className="size-full min-h-[360px] border-0 grayscale-[35%]"
      />
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl bg-card/95 px-4 py-3 text-sm shadow-card backdrop-blur">
        <p className="font-display font-extrabold text-foreground">Service area</p>
        <p className="text-muted-foreground">All of Miami-Dade &amp; Broward</p>
      </div>
    </div>
  );
}
