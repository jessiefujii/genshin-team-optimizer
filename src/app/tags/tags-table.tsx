"use client";

import { useMemo, useState } from "react";
import { FAMILIES, ROLES, type CharacterTags } from "@/types/tags";

export type TagRow = CharacterTags & { element: string; weapon: string; rarity: number };

const ELEMENTS = ["Pyro", "Hydro", "Electro", "Cryo", "Anemo", "Geo", "Dendro"];

const ELEMENT_STYLES: Record<string, string> = {
  Pyro: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  Hydro: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  Electro: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  Cryo: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
  Anemo: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  Geo: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  Dendro: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
};

const chip = "inline-block rounded px-1.5 py-0.5 text-xs whitespace-nowrap";
const quietChip = `${chip} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`;
const select =
  "rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

const needsVerify = (row: TagRow) => row.notes?.includes("VERIFY") ?? false;

export default function TagsTable({ rows }: { rows: TagRow[] }) {
  const [search, setSearch] = useState("");
  const [element, setElement] = useState("");
  const [role, setRole] = useState("");
  const [family, setFamily] = useState("");
  const [verifyOnly, setVerifyOnly] = useState(false);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!query || row.id.toLowerCase().includes(query)) &&
        (!element || row.element === element) &&
        (!role || row.roles.includes(role as TagRow["roles"][number])) &&
        (!family || row.families?.includes(family as NonNullable<TagRow["families"]>[number])) &&
        (!verifyOnly || needsVerify(row)),
    );
  }, [rows, search, element, role, family, verifyOnly]);

  const verifyCount = rows.filter(needsVerify).length;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search characters"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${select} w-full sm:w-56`}
        />
        <select value={element} onChange={(e) => setElement(e.target.value)} className={select} aria-label="Element">
          <option value="">All elements</option>
          {ELEMENTS.map((el) => (
            <option key={el}>{el}</option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} className={select} aria-label="Role">
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={family} onChange={(e) => setFamily(e.target.value)} className={select} aria-label="Family">
          <option value="">All families</option>
          {FAMILIES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={verifyOnly} onChange={(e) => setVerifyOnly(e.target.checked)} />
          Only VERIFY ({verifyCount})
        </label>
        <span className="text-sm text-zinc-500 sm:ml-auto">
          {visible.length} of {rows.length} characters
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              {["Character", "Element", "Roles", "Field", "Energy", "Reactions", "Rotation", "Buffs", "Notes"].map(
                (h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visible.map((row) => (
              <tr
                key={row.id}
                className={`align-top ${needsVerify(row) ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
              >
                <td className="px-3 py-2">
                  <div className="font-medium whitespace-nowrap">{row.id}</div>
                  <div className="text-xs text-zinc-500 whitespace-nowrap">
                    {row.rarity}★ {row.weapon}
                  </div>
                  {needsVerify(row) && (
                    <span className={`${chip} mt-1 bg-amber-200 font-semibold text-amber-900 dark:bg-amber-800 dark:text-amber-100`}>
                      VERIFY
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`${chip} ${ELEMENT_STYLES[row.element] ?? quietChip}`}>{row.element}</span>
                  {row.families?.map((f) => (
                    <div key={f} className="mt-1">
                      <span className={quietChip}>{f}</span>
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.roles.map((r) => (
                      <span key={r} className={quietChip}>
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">{row.fieldTime}</td>
                <td className="px-3 py-2">{row.energyNeed}</td>
                <td className="px-3 py-2">
                  <div className="flex max-w-56 flex-wrap gap-1">
                    {row.reactions.length === 0 && <span className="text-zinc-400">none</span>}
                    {row.reactions.map((r) => (
                      <span key={r} className={quietChip}>
                        {r}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-xs text-zinc-500">
                    {row.rotation.slot}
                    {row.rotation.buffSeconds ? ` · ${row.rotation.buffSeconds}s` : ""}
                  </div>
                  <div className="font-mono text-xs whitespace-nowrap">{row.rotation.actions.join(" → ")}</div>
                </td>
                <td className="px-3 py-2 text-xs">
                  {row.buffs?.map((b) => (
                    <div key={b.stat} className="min-w-40">
                      {b.stat} <span className="text-zinc-500">({b.scope})</span>
                    </div>
                  ))}
                </td>
                <td className="min-w-64 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {row.teamPrefs?.map((pref, i) => (
                    <div key={i} className="mb-1 font-medium text-zinc-800 dark:text-zinc-200">
                      Prefers: {pref.kind === "partner" ? pref.ids.join(" or ") : pref.note}
                    </div>
                  ))}
                  {row.notes?.replace(/\s*VERIFY:.*$/, "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
