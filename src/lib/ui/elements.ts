// Tailwind classes for element chips, shared by /tags and the planner.
export const ELEMENT_STYLES: Record<string, string> = {
  Pyro: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  Hydro: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  Electro: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  Cryo: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
  Anemo: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  Geo: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  Dendro: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

export const chip = "inline-block rounded px-1.5 py-0.5 text-xs whitespace-nowrap";
export const quietChip = `${chip} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`;
export const control =
  "rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export const elementChip = (element: string) => `${chip} ${ELEMENT_STYLES[element] ?? quietChip}`;
