import type { ScoringCharacter } from "./types";

// One action in a team rotation, in KQM notation (N, C, E, hold E, Q, N2C x8).
export interface RotationStep {
  character: string;
  action: string;
}

// Skill and burst only: what a second main DPS does when someone else carries.
const SUPPORT_ACTION = /^(hold )?[EQ]$/;

// Builds a team's rotation from its members' rotation tags (design doc: "How a rotation is generated"):
// setup first (longest-lasting effects first), then buffers with the shortest buff last so it is still
// up when the carry starts, then the carry's own actions. No carry: everyone in that order, carries last.
export function generateRotation(members: ScoringCharacter[], carryId: string | null): RotationStep[] {
  const carry = members.find((m) => m.id === carryId);
  const lasting = (m: ScoringCharacter) => m.rotation.buffSeconds ?? 0;
  const byDuration = (a: ScoringCharacter, b: ScoringCharacter) => lasting(b) - lasting(a);

  const others = members.filter((m) => m !== carry);
  const supportCarries = carry ? others.filter((m) => m.rotation.slot === "carry") : [];
  const setup = others.filter((m) => m.rotation.slot === "setup" || supportCarries.includes(m)).sort(byDuration);
  const buffers = others.filter((m) => m.rotation.slot === "buffer").sort(byDuration);
  const carries = carry ? [carry] : others.filter((m) => m.rotation.slot === "carry");

  const steps: RotationStep[] = [];
  for (const m of [...setup, ...buffers, ...carries]) {
    const actions = supportCarries.includes(m) ? m.rotation.actions.filter((a) => SUPPORT_ACTION.test(a)) : m.rotation.actions;
    for (const action of actions) steps.push({ character: m.id, action });
  }
  return steps;
}
