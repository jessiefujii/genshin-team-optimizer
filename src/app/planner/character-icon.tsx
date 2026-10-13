import Image from "next/image";

// A character's icon from Enka's CDN (#179): "You can get icons of characters, weapons and artifacts via Enka, by URL
// `https://enka.network/ui/[icon_name].png`" (EnkaNetwork/API-docs, docs/gi/api.md). Next's image optimizer resizes
// them (the originals are ~60 KB each); next.config.ts allows only that path.
export default function CharacterIcon({ icon, size, className = "" }: { icon?: string; size: number; className?: string }) {
  if (!icon) return null;
  return (
    <Image
      src={`https://enka.network/ui/${icon}.png`}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 ${className}`}
    />
  );
}
