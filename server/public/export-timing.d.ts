import type { TransitionKind } from "../../client/src/types";

export function transitionLength(kind: TransitionKind, requested: number, before: number, after: number): number;
export function timeline(
  beats: { seconds: number; transition: TransitionKind }[],
  transitionSeconds: number,
): { starts: number[]; overlaps: number[]; total: number };
