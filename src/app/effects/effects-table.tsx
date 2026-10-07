"use client";

import { useMemo, useState } from "react";
import { EFFECT_SOURCES, type EffectTag } from "@/types/effects";
import { chip, control as select, quietChip } from "@/lib/ui/elements";

const needsVerify = (row: EffectTag) => row.notes?.startsWith("VERIFY:") ?? false;

const SOURCE_LABEL = { weapon: "Weapon", set: "Set", constellation: "Constellation" } as const;

function requirement(row: EffectTag) {
  if (row.source === "set") return `${row.requires}pc`;
  if (row.source === "constellation") return `C${row.requires}`;
  return null;
}

export default function EffectsTable({ rows }: { rows: EffectTag[] }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [verifyOnly, setVerifyOnly] = useState(false);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!query || row.id.toLowerCase().includes(query) || row.name?.toLowerCase().includes(query)) &&
        (!source || row.source === source) &&
        (!verifyOnly || needsVerify(row)),
    );
  }, [rows, search, source, verifyOnly]);

  const verifyCount = rows.filter(needsVerify).length;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search items or characters"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${select} w-full sm:w-64`}
        />
        <select value={source} onChange={(e) => setSource(e.target.value)} className={select} aria-label="Source">
          <option value="">All sources</option>
          {EFFECT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={verifyOnly} onChange={(e) => setVerifyOnly(e.target.checked)} />
          Only VERIFY ({verifyCount})
        </label>
        <span className="text-sm text-zinc-500 sm:ml-auto">
          {visible.length} of {rows.length} effects
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
            <tr>
              {["Item", "Source", "Buffs", "Adds", "Drafted from"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visible.map((row) => (
              <tr
                key={`${row.source}|${row.id}|${row.requires ?? ""}`}
                className={`align-top ${needsVerify(row) ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}
              >
                <td className="px-3 py-2">
                  <div className="font-medium whitespace-nowrap">
                    {row.id} {requirement(row) && <span className="text-zinc-500">{requirement(row)}</span>}
                  </div>
                  {row.name && <div className="text-xs text-zinc-500">{row.name}</div>}
                  {needsVerify(row) && (
                    <span className={`${chip} mt-1 bg-amber-200 font-semibold text-amber-900 dark:bg-amber-800 dark:text-amber-100`}>
                      VERIFY
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{SOURCE_LABEL[row.source]}</td>
                <td className="px-3 py-2">
                  {row.buffs?.map((b) => (
                    <div key={b.stat + b.scope} className="min-w-44">
                      {b.stat} <span className="text-zinc-500">({b.scope})</span>
                      {(b.affects || b.elements || b.reactions) && (
                        <div className="text-xs text-zinc-500">
                          only for:{" "}
                          {[b.affects && `${b.affects} scalers`, b.elements?.join("/"), b.reactions?.join("/")]
                            .filter(Boolean)
                            .join("; ")}
                        </div>
                      )}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.roles?.map((r) => (
                      <span key={r} className={quietChip}>
                        {r}
                      </span>
                    ))}
                    {row.infusion && <span className={quietChip}>{row.infusion} infusion</span>}
                  </div>
                </td>
                <td className="min-w-80 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {row.notes?.replace(/^VERIFY: drafted from text: /, "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
