import type { Metadata } from "next";
import effectsJson from "../../../data/effects.json";
import type { EffectTag } from "@/types/effects";
import EffectsTable from "./effects-table";

export const metadata: Metadata = {
  title: "Item effects",
  description: "Review the team effects in data/effects.json",
};

export default function EffectsPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Item effects</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Team-relevant effects of weapons, artifact sets and constellations in{" "}
        <code className="font-mono">data/effects.json</code>. Rows marked VERIFY were drafted from item text by{" "}
        <code className="font-mono">scripts/draft-effects.mjs</code>; remove VERIFY from an entry once it is checked.
      </p>
      <EffectsTable rows={effectsJson as EffectTag[]} />
    </main>
  );
}
