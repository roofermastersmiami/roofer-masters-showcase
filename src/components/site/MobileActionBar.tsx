import { Phone } from "lucide-react";
import { BUSINESS } from "@/lib/site";
import { WhatsAppIcon } from "./SocialIcons";

/** Sticky thumb-zone actions on phones. */
export function MobileActionBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_-12px_oklch(0.2_0.05_250/0.3)] backdrop-blur-xl md:hidden">
      <div className="grid grid-cols-[1.4fr_1fr] gap-2">
        <a
          href={BUSINESS.phoneHref}
          className="animate-pulse-ring flex h-14 items-center justify-center gap-2 rounded-xl bg-primary font-bold text-primary-foreground"
        >
          <Phone className="size-5" /> Call Now
        </a>
        <a
          href={BUSINESS.whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-14 items-center justify-center gap-2 rounded-xl bg-whatsapp font-bold text-whatsapp-foreground"
        >
          <WhatsAppIcon className="size-5" /> WhatsApp
        </a>
      </div>
    </div>
  );
}
