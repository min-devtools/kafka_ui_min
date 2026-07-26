import type { GroupOffset } from "./types";

/**
 * In-memory lag history per (connection, group), fed by the group-offsets poll.
 * Survives tab close/reopen within the app session; lost on restart by design —
 * a trend chart is only meaningful for what this session has observed.
 */
export interface LagSample {
  t: number;
  total: number;
  byTopic: Record<string, number>;
}

/** ~1 hour of samples at the 10s sync interval */
const CAP = 360;

const store = new Map<string, LagSample[]>();

export const lagKey = (connId: string, group: string) => `${connId}::${group}`;

export function pushLagSample(key: string, offsets: GroupOffset[], t: number) {
  const samples = store.get(key) ?? [];
  // polls can repeat a fetch timestamp on remount — one sample per instant
  if (samples.length && samples[samples.length - 1].t >= t) return;
  const byTopic: Record<string, number> = {};
  for (const o of offsets) byTopic[o.topic] = (byTopic[o.topic] ?? 0) + o.lag;
  const total = Object.values(byTopic).reduce((sum, lag) => sum + lag, 0);
  samples.push({ t, total, byTopic });
  if (samples.length > CAP) samples.splice(0, samples.length - CAP);
  store.set(key, samples);
}

export function getLagHistory(key: string): LagSample[] {
  return store.get(key) ?? [];
}
