import { Link } from "@tanstack/react-router";
import logo3d from "@/assets/logo-3d.webp";
import logoMark from "@/assets/logo-mark.webp";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  linked = true,
  priority = false,
}: {
  className?: string;
  linked?: boolean;
  priority?: boolean;
}) {
  const img = (
    <img
      src={logo3d}
      alt="Roofer Masters – Your Roof, Our Masterpiece"
      width={720}
      height={591}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={cn("logo-depth h-12 w-auto select-none", className)}
    />
  );
  if (!linked) return img;
  return (
    <Link to="/" aria-label="Roofer Masters home" className="inline-flex shrink-0">
      {img}
    </Link>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src={logoMark}
      alt=""
      aria-hidden="true"
      width={300}
      height={104}
      loading="lazy"
      className={cn("logo-depth h-8 w-auto", className)}
    />
  );
}
