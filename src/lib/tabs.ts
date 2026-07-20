import type { TabDef, TabKind } from "./types";

/**
 * Pure decisions of the per-connection tab model. The store owns the wiring (React state,
 * side effects); everything here is a plain function of the tab list, which is where the
 * edge cases live — closing the last tab, a connection disappearing under open tabs.
 */

/** stable id for a connection-bound tab: one tab per (kind, connection), never shared */
export const connTabId = (kind: TabKind, connId: string): string => `${kind}:${connId}`;

/**
 * Which of a connection's open tabs to focus when the user picks it in the sidebar.
 * Prefers `preferKind` so "go to prod" lands on the same view every time; null = it has
 * nothing open yet and the caller should create the default tab.
 */
export function pickConnTab(tabs: TabDef[], connId: string, preferKind: TabKind): string | null {
  const own = tabs.filter((t) => t.connId === connId);
  if (!own.length) return null;
  return (own.find((t) => t.kind === preferKind) ?? own[0]).id;
}

/**
 * Drop tabs whose connection is gone, keeping a valid selection. Returns `null` when
 * nothing changed so callers can skip the state update.
 *
 * `fallback` is used only if pruning empties the bar — an app with no tabs at all has no
 * valid `activeTabId`, so there must always be one tab left standing.
 */
export function pruneConnTabs(
  tabs: TabDef[],
  activeTabId: string,
  connIds: readonly string[],
  fallback: TabDef,
): { tabs: TabDef[]; activeTabId: string; dropped: TabDef[] } | null {
  const kept = tabs.filter((t) => !t.connId || connIds.includes(t.connId));
  if (kept.length === tabs.length) return null;
  const dropped = tabs.filter((t) => !kept.includes(t));
  const next = kept.length ? kept : [fallback];
  return {
    tabs: next,
    activeTabId: next.some((t) => t.id === activeTabId) ? activeTabId : next[0].id,
    dropped,
  };
}
