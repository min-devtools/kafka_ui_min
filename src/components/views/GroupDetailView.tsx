import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../ui/Badge";
import { ToolButton } from "../../ui/ToolButton";
import { Icon } from "../../ui/Icon";
import { SortTh } from "../../ui/SortTh";
import { FieldChip } from "../../ui/Pills";
import { useSortedRows } from "../../lib/useSort";
import { useApp } from "../../store";
import { useActiveConnection, useGroupMembers, useGroupOffsets, useGroups } from "../../lib/queries";
import { deleteGroup, resetOffsets } from "../../lib/kafka";
import type { GroupOffset } from "../../lib/types";
import { DateTimeModal, toLocalStamp } from "../../ui/DateTimeModal";

type ResetMode = "earliest" | "latest" | "offset" | "timestamp";

const MODES: { key: ResetMode; label: string; icon: "chevrons-left" | "chevrons-right" | "pencil" | "history" }[] = [
  { key: "earliest", label: "Earliest", icon: "chevrons-left" },
  { key: "latest", label: "Latest", icon: "chevrons-right" },
  { key: "offset", label: "Offset", icon: "pencil" },
  { key: "timestamp", label: "Timestamp", icon: "history" },
];

function ResetModal({ group, topic, rows, initialPartition, busy, onClose, onApply }: {
  group: string;
  topic: string;
  rows: GroupOffset[];
  /** preselect a single partition (row click) — null = all */
  initialPartition: number | null;
  busy: boolean;
  onClose: () => void;
  onApply: (partitions: number[] | null, mode: ResetMode, value?: number) => void;
}) {
  const all = rows.map((r) => r.partition);
  const [picked, setPicked] = useState<Set<number>>(
    new Set(initialPartition == null ? all : [initialPartition]),
  );
  const [mode, setMode] = useState<ResetMode>("earliest");
  const [offset, setOffset] = useState("0");
  const [stamp, setStamp] = useState(toLocalStamp(new Date()));
  const [pickingTime, setPickingTime] = useState(false);

  const toggle = (p: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const allPicked = picked.size === all.length;
  const valid =
    picked.size > 0 &&
    (mode !== "offset" || (Number.isFinite(Number(offset)) && Number(offset) >= 0)) &&
    (mode !== "timestamp" || Number.isFinite(new Date(stamp).getTime()));

  const apply = () => {
    const value = mode === "offset" ? Math.floor(Number(offset)) : mode === "timestamp" ? new Date(stamp).getTime() : undefined;
    onApply(allPicked ? null : [...picked].sort((a, b) => a - b), mode, value);
  };

  // Esc cancels, Enter resets (respecting valid/busy, same guard as the button's disabled
  // state) — capture phase, mirrors Dialog.tsx. Skipped while the nested DateTimeModal
  // (pickingTime) is open so its own handler is the one that gets the key.
  useEffect(() => {
    if (pickingTime) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        if (!busy) onClose();
      } else if (valid && !busy) {
        apply();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [pickingTime, busy, valid, onClose, apply]);

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="prompt-dialog" style={{ width: 480 }}>
        <strong>Reset offsets · {topic}</strong>
        <p className="prompt-dialog-msg" style={{ margin: 0 }}>
          Commit new offsets for group "{group}". The group must have no active members.
        </p>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ color: "var(--text-3)", fontSize: "0.8462rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Partitions</span>
            <span style={{ flex: 1 }} />
            <ToolButton onClick={() => setPicked(new Set(allPicked ? [] : all))}>
              {allPicked ? "None" : "All"}
            </ToolButton>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 132, overflowY: "auto" }}>
            {rows.map((r) => (
              <ToolButton
                key={r.partition}
                variant={picked.has(r.partition) ? "primary" : "default"}
                title={`Partition ${r.partition} · committed ${r.committed} · lag ${r.lag}`}
                onClick={() => toggle(r.partition)}
              >
                {r.partition}
              </ToolButton>
            ))}
          </div>
        </div>
        <div>
          <div style={{ color: "var(--text-3)", fontSize: "0.8462rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Reset to</div>
          <div style={{ display: "flex", gap: 6 }}>
            {MODES.map((m) => (
              <ToolButton key={m.key} variant={mode === m.key ? "primary" : "default"} onClick={() => setMode(m.key)}>
                <Icon name={m.icon} /> {m.label}
              </ToolButton>
            ))}
          </div>
          {mode === "offset" && (
            <input
              className="index-search"
              style={{ marginTop: 8, width: 180, font: "1rem var(--font-mono)" }}
              type="number"
              min={0}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              placeholder="Offset (clamped to low/high)"
            />
          )}
          {mode === "timestamp" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span style={{ font: "1rem var(--font-mono)" }}>{new Date(stamp).toLocaleString()}</span>
              <ToolButton onClick={() => setPickingTime(true)}><Icon name="history" /> Change…</ToolButton>
            </div>
          )}
        </div>
        <div className="prompt-dialog-foot">
          <ToolButton disabled={busy} onClick={onClose}>Cancel</ToolButton>
          <ToolButton variant="danger" disabled={busy || !valid} onClick={apply}>
            <Icon name="check" /> Reset {allPicked ? "all" : picked.size} partition{allPicked || picked.size !== 1 ? "s" : ""}
          </ToolButton>
        </div>
      </div>
      {pickingTime && (
        <DateTimeModal
          value={stamp}
          onClose={() => setPickingTime(false)}
          onApply={(v) => { setStamp(v); setPickingTime(false); }}
        />
      )}
    </div>
  );
}

function OffsetTable({ rows, onPick }: { rows: GroupOffset[]; onPick: (partition: number) => void }) {
  const { sorted, sort, cycleSort } = useSortedRows<GroupOffset>(rows, (r, col) =>
    r[col as "partition" | "committed" | "high" | "lag"],
  );
  return (
    <table>
      <thead>
        <tr>
          <SortTh col="partition" sort={sort} onSort={cycleSort} style={{ width: 110 }}>Partition</SortTh>
          <SortTh col="committed" sort={sort} onSort={cycleSort}>Committed</SortTh>
          <SortTh col="high" sort={sort} onSort={cycleSort}>High</SortTh>
          <SortTh col="lag" sort={sort} onSort={cycleSort}>Lag</SortTh>
        </tr>
      </thead>
      <tbody>
        {(sorted ?? []).map((o) => (
          <tr key={o.partition} title="Click to reset this partition" onClick={() => onPick(o.partition)}>
            <td>{o.partition}</td>
            <td>{o.committed}</td>
            <td>{o.high}</td>
            <td style={{ color: o.lag > 0 ? "var(--orange)" : "var(--green)" }}>{o.lag}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GroupDetailView({ tabId, active }: { tabId: string; active: boolean }) {
  const group = useApp((s) => s.groupTabs[tabId]?.group ?? null);
  const conn = useActiveConnection();
  const groups = useGroups();
  const offsets = useGroupOffsets(group);
  const members = useGroupMembers(group);
  const queryClient = useQueryClient();
  const showToast = useApp((s) => s.showToast);
  const openDialog = useApp((s) => s.openDialog);
  const closeTab = useApp((s) => s.closeTab);
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<{ topic: string; partition: number | null } | null>(null);

  const info = (groups.data ?? []).find((g) => g.name === group);
  const topics = [...new Set((offsets.data ?? []).map((o) => o.topic))];
  const totalLag = (offsets.data ?? []).reduce((sum, o) => sum + o.lag, 0);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["groups"] });
    void queryClient.invalidateQueries({ queryKey: ["group-members"] });
    void queryClient.invalidateQueries({ queryKey: ["group-offsets"] });
  };

  const applyReset = async (topic: string, partitions: number[] | null, mode: ResetMode, value?: number) => {
    if (!conn || !group) return;
    setBusy(true);
    const scope = partitions == null ? "every partition" : `partition${partitions.length === 1 ? "" : "s"} ${partitions.join(", ")}`;
    const target = mode === "offset" ? `offset ${value}` : mode === "timestamp" ? new Date(value!).toLocaleString() : mode;
    try {
      if (partitions == null) {
        await resetOffsets(conn, group, topic, mode, { partition: null, offset: mode === "offset" ? value : null, timestampMs: mode === "timestamp" ? value : null });
      } else {
        for (const p of partitions) {
          await resetOffsets(conn, group, topic, mode, { partition: p, offset: mode === "offset" ? value : null, timestampMs: mode === "timestamp" ? value : null });
        }
      }
      showToast("Offsets reset", `${group} · ${topic} · ${scope} → ${target}.`);
      setResetTarget(null);
      refresh();
    } catch (err) {
      showToast("Reset failed", String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  const removeGroup = async () => {
    if (!conn || !group) return;
    const ok = await openDialog({
      kind: "confirm",
      title: `Delete group "${group}"`,
      message: "Removes the group and all its committed offsets. The group must have no active members.",
      confirmLabel: "Delete group",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteGroup(conn, group);
      showToast("Group deleted", `${group} removed from the cluster.`);
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      closeTab(tabId);
    } catch (err) {
      showToast("Delete failed", String(err), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`content group-detail-view ${active ? "active" : ""}`}>
      <div className="index-table-wrap" style={{ padding: 12 }}>
        {!conn && <div className="empty-note">Connect to a cluster to inspect this group.</div>}
        {conn && group && (
          <>
            <div className="panel">
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h3 style={{ margin: 0 }}>{group}</h3>
                <span className={`health-pill ${info?.state === "Stable" ? "green" : "orange"}`}>{info?.state || "unknown"}</span>
                <Badge>{members.data?.length ?? info?.members ?? 0} members</Badge>
                <Badge>{topics.length} topics</Badge>
                <Badge tone={totalLag > 0 ? "yellow" : "green"}>lag {totalLag}</Badge>
                <span style={{ flex: 1 }} />
                <ToolButton disabled={busy} title="Refresh members and offsets" onClick={refresh}><Icon name="refresh" /></ToolButton>
                <ToolButton variant="danger" disabled={busy} title="Delete this consumer group" onClick={() => void removeGroup()}>
                  <Icon name="trash" /> Delete group
                </ToolButton>
              </div>
            </div>

            <div className="panel">
              <h3>Members</h3>
              {members.isLoading && <div className="empty-note">Loading group members…</div>}
              {members.isError && <div className="empty-note">Unable to load group members.</div>}
              {members.data?.length === 0 && <div className="empty-note">No active members — the group is empty.</div>}
              {!!members.data?.length && (
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Host</th>
                      <th>Member ID</th>
                      <th>Assignments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.data.map((m) => (
                      <tr key={m.memberId}>
                        <td><strong>{m.clientId || "—"}</strong></td>
                        <td style={{ fontFamily: "var(--font-mono)" }}>{m.clientHost}</td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8462rem", color: "var(--text-3)" }}>{m.memberId}</td>
                        <td>
                          {m.assignments.length
                            ? m.assignments.map((a) => (
                                <FieldChip key={a.topic}>{a.topic} [{a.partitions.join(", ")}]</FieldChip>
                              ))
                            : <span style={{ color: "var(--text-3)" }}>none</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="panel">
              <h3>Committed offsets</h3>
              {offsets.isLoading && <div className="empty-note">Loading committed offsets…</div>}
              {offsets.data && offsets.data.length === 0 && <div className="empty-note">No committed offsets for this group.</div>}
              {topics.map((topic) => {
                const rows = (offsets.data ?? []).filter((o) => o.topic === topic);
                const lag = rows.reduce((sum, o) => sum + o.lag, 0);
                return (
                  <div key={topic} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
                      <strong>{topic}</strong>
                      <Badge tone={lag > 0 ? "yellow" : "green"}>lag {lag}</Badge>
                      <span style={{ flex: 1 }} />
                      <ToolButton disabled={busy} title="Reset offsets for this topic" onClick={() => setResetTarget({ topic, partition: null })}>
                        <Icon name="history" /> Reset offsets…
                      </ToolButton>
                    </div>
                    <OffsetTable rows={rows} onPick={(partition) => setResetTarget({ topic, partition })} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {resetTarget && group && (
        <ResetModal
          group={group}
          topic={resetTarget.topic}
          rows={(offsets.data ?? []).filter((o) => o.topic === resetTarget.topic)}
          initialPartition={resetTarget.partition}
          busy={busy}
          onClose={() => setResetTarget(null)}
          onApply={(partitions, mode, value) => void applyReset(resetTarget.topic, partitions, mode, value)}
        />
      )}
    </section>
  );
}
