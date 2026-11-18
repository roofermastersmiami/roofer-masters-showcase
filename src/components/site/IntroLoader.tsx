import { useEffect, useState } from "react";
import logo3d from "@/assets/logo-3d.webp";

/** Branded intro shown on first page load; CSS-driven so content paints underneath. */
export function IntroLoader() {
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setMounted(false), 2000);
    return () => clearTimeout(t);
  }, []);
  if (!mounted) return null;
  return (
    <div
      aria-hidden="true"
      className="animate-intro-out pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-steel"
    >
      <img
        src={logo3d}
        alt=""
        width={720}
        height={591}
        className="animate-intro-logo logo-depth w-56 sm:w-72"
      />
      <div className="mt-8 h-1 w-40 overflow-hidden rounded-full bg-border">
        <div className="animate-intro-bar h-full origin-left bg-gradient-primary" />
      </div>
    </div>
  );
}
