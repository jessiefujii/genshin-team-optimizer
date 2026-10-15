"use client";

import { useState } from "react";
import type { RotationStep } from "@/lib/scoring/rotation";
import type { ScoredTeam } from "@/lib/scoring/types";
import { elementChip, quietChip } from "@/lib/ui/elements";
import type { PlannerCharacter } from "./types";

interface Props {
  teams: ScoredTeam[];
  byId: Map<string, PlannerCharacter>;
}

// Consecutive steps by the same character become one block: "Xingqiu Q, E".
function groupSteps(steps: RotationStep[]) {
  const groups: { character: string; actions: string[] }[] = [];
  for (const s of steps) {
    const last = groups[groups.length - 1];
    if (last?.character === s.character) last.actions.push(s.action);
    else groups.push({ character: s.character, actions: [s.action] });
  }
  return groups;
}

const reactionLabel = (r: string) => r.replace(/(^|-)(\w)/g, (_, dash, c) => (dash ? " " : "") + c.toUpperCase());

export default function ResultsList({ teams, byId }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ol className="mt-3 space-y-2">
      {teams.map((team, i) => {
        const key = team.members.join("|");
        const expanded = open === key;
        return (
          <li key={key} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : key)}
              aria-expanded={expanded}
              className="flex w-full items-start gap-3 p-3 text-left"
            >
              <span className="w-6 shrink-0 text-sm text-zinc-500">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap gap-1.5">
                  {team.members.map((id) => (
                    <span
                      key={id}
                      className={`${elementChip(byId.get(id)?.element ?? "")} ${id === team.mainDps ? "font-semibold ring-1 ring-current" : ""}`}
                    >
                      {id}
                    </span>
                  ))}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1">
                  {team.activeReactions.map((r) => (
                    <span key={r} className={quietChip}>
                      {reactionLabel(r)}
                    </span>
                  ))}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-lg font-semibold tabular-nums">{team.score}</span>
                <span className="text-xs text-zinc-500">{expanded ? "Hide" : "Why"}</span>
              </span>
            </button>
            {expanded && (
              <div className="border-t border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                <p className="text-zinc-600 dark:text-zinc-400">
                  {team.mainDps ? (
                    <>
                      Main DPS: <span className="font-medium text-zinc-900 dark:text-zinc-100">{team.mainDps}</span>
                      {team.onField && team.onField !== team.mainDps && (
                        <>
                          {" · "}On-field: <span className="font-medium text-zinc-900 dark:text-zinc-100">{team.onField}</span>
                        </>
                      )}
                    </>
                  ) : (
                    "No main DPS"
                  )}
                </p>
                <div className="mt-2">
                  <p className="text-xs font-medium text-zinc-500">Rotation</p>
                  <ol className="mt-1 flex flex-wrap items-center gap-1 text-xs" aria-label="Rotation">
                    {groupSteps(team.rotation).map((g, k) => (
                      <li key={k} className="flex items-center gap-1">
                        {k > 0 && <span className="text-zinc-400" aria-hidden="true">→</span>}
                        <span className={elementChip(byId.get(g.character)?.element ?? "")}>
                          {g.character} <span className="font-mono">{g.actions.join(", ")}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
                {team.energy.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-zinc-500">Energy</p>
                    <table className="mt-1 text-xs">
                      <thead className="text-zinc-500">
                        <tr>
                          <th className="pr-3 text-left font-normal">Burst</th>
                          <th className="pr-3 text-right font-normal">Cost</th>
                          <th className="pr-3 text-right font-normal">ER target</th>
                          <th className="pr-3 text-right font-normal" title="From this team's particles (#37)">Needs here</th>
                          <th className="text-right font-normal">ER</th>
                        </tr>
                      </thead>
                      <tbody>
                        {team.energy.map((e) => {
                          const low = e.target !== undefined && e.er !== undefined && e.er < e.target;
                          const short = e.need !== undefined && e.target !== undefined && e.need > (e.er ?? e.target);
                          return (
                            <tr key={e.id}>
                              <td className="pr-3">{e.id}</td>
                              <td className="pr-3 text-right tabular-nums">{e.cost}</td>
                              <td className="pr-3 text-right tabular-nums">{e.target === undefined ? "not checked" : `${e.target}%`}</td>
                              <td className={`pr-3 text-right tabular-nums ${short ? "text-red-700 dark:text-red-400" : ""}`}>
                                {e.need === undefined ? "" : `${e.need}%`}
                              </td>
                              <td
                                className={`text-right tabular-nums ${e.er === undefined ? "text-zinc-400" : low ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
                              >
                                {e.er === undefined ? "no build" : `${e.er}%`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {team.defaultBuilds.length > 0 && (
                  <p className="mt-1 text-xs text-zinc-500">
                    {team.defaultBuilds.length === 4
                      ? "Assumes default builds: no imported stats for this team."
                      : `Assumes a default build for ${team.defaultBuilds.join(", ")} (no imported stats).`}
                  </p>
                )}
                <table className="mt-2 w-full">
                  <tbody>
                    {team.breakdown.map((line, j) => (
                      <tr key={j} className="align-top">
                        <td
                          className={`w-12 py-0.5 pr-2 text-right tabular-nums ${line.points < 0 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}
                        >
                          {line.points > 0 ? `+${line.points}` : line.points}
                        </td>
                        <td className="w-28 py-0.5 pr-2 text-zinc-500">{line.rule}</td>
                        <td className="py-0.5">{line.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
