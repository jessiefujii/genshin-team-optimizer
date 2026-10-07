"use client";

import { useState } from "react";
import type { ScoredTeam } from "@/lib/scoring/types";
import { elementChip, quietChip } from "@/lib/ui/elements";
import type { PlannerCharacter } from "./types";

interface Props {
  teams: ScoredTeam[];
  byId: Map<string, PlannerCharacter>;
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
                      className={`${elementChip(byId.get(id)?.element ?? "")} ${id === team.carry ? "font-semibold ring-1 ring-current" : ""}`}
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
                  {team.carry ? (
                    <>
                      Carry: <span className="font-medium text-zinc-900 dark:text-zinc-100">{team.carry}</span>
                    </>
                  ) : (
                    "No main DPS"
                  )}
                </p>
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
