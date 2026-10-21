import Image from "next/image";

// Character and weapon icons from Enka's CDN (#179, #180): "You can get icons of characters, weapons and artifacts via
// Enka, by URL `https://enka.network/ui/[icon_name].png`" (EnkaNetwork/API-docs, docs/gi/api.md). Next's image optimizer
// resizes them (the originals are ~60 KB each); next.config.ts allows only that path.
function EnkaIcon({ icon, size, title, className }: { icon?: string; size: number; title?: string; className: string }) {
  if (!icon) return null;
  return (
    <Image
      src={`https://enka.network/ui/${icon}.png`}
      alt={title ?? ""}
      title={title}
      width={size}
      height={size}
      className={`shrink-0 bg-zinc-100 dark:bg-zinc-800 ${className}`}
    />
  );
}

export default function CharacterIcon({ icon, size, className = "" }: { icon?: string; size: number; className?: string }) {
  return <EnkaIcon icon={icon} size={size} className={`rounded-full ${className}`} />;
}

// title: the weapon's name, shown on hover where the name isn't written next to it.
export function WeaponIcon({ icon, size, title, className = "" }: { icon?: string; size: number; title?: string; className?: string }) {
  return <EnkaIcon icon={icon} size={size} title={title} className={`rounded ${className}`} />;
}
