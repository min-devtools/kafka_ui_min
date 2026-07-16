import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../../ui/Badge";
import { ToolButton } from "../../ui/ToolButton";
import { Combobox } from "../../ui/Combobox";
import { CodeInput } from "../../ui/CodeInput";
import { DateTimeModal } from "../../ui/DateTimeModal";
import { SortTh } from "../../ui/SortTh";
import { Icon } from "../../ui/Icon";
import { LoadingBar } from "../../ui/LoadingBar";
import { useSortedRows } from "../../lib/useSort";
import { useApp } from "../../store";
import { useActiveConnection, useClusterMeta } from "../../lib/queries";
import { consumeMessages, type ConsumeFrom } from "../../lib/kafka";
import { setMessageFields } from "../../lib/monaco";
import { formatValue, getPath } from "../../lib/format";
import type { MessageRec } from "../../lib/types";
import { FullTopicSearch } from "./FullTopicSearch";
import { compileFilter, type FilterFn, type JsFilter } from "../../lib/messageFilter";

/** Walk sampled payloads, collect dotted field paths for filter autocomplete. */
function collectPaths(v: unknown, prefix: string, out: Set<string>, depth: number) {
  if (depth > 4 || v == null || out.size > 500) return;
  if (Array.isArray(v)) {
    if (v.length) collectPaths(v[0], prefix, out, depth);
    return;
  }
  if (typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const p = prefix ? `${prefix}.${k}` : k;
      out.add(p);
      collectPaths(val, p, out, depth + 1);
    }
  }
}

type Row = MessageRec & { json: unknown };

/** "value.user.id" → "user.id"; bare "user.id" also accepted */
const stripValue = (path: string) => (path.startsWith("value.") ? path.slice(6) : path);

function tryParse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

export function MessagesView({ tabId, active }: { tabId: string; active: boolean }) {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const { msgTabs, selectedMsg, selectMsg, showToast, renameTab } = useApp();
  const tabTopic = msgTabs[tabId]?.topic ?? "";

  const [topic, setTopic] = useState(tabTopic);
  const [partition, setPartition] = useState<number | null>(null);
  const [limit, setLimit] = useState(100);
  const [from, setFrom] = useState<ConsumeFrom>("end");
  const [fromOffset, setFromOffset] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [colsInput, setColsInput] = useState("");
  const [messages, setMessages] = useState<MessageRec[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [jsFilters, setJsFilters] = useState<JsFilter[]>([]);
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [jsDraft, setJsDraft] = useState("");
  const vimStatusRef = useRef<HTMLSpanElement>(null);

  const [jsModalOpen, setJsModalOpen] = useState(false);
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null);

  const openNewFilter = () => {
    setEditingFilterId(null);
    setJsModalOpen(true);
  };

  const openEditFilter = (f: JsFilter) => {
    setEditingFilterId(f.id);
    setJsDraft(f.code);
    setJsModalOpen(true);
  };

  const saveJsFilter = () => {
    const code = jsDraft.trim();
    if (!code) return;
    try {
      compileFilter(code);
    } catch (err) {
      showToast("Invalid filter", String(err), "err");
      return;
    }
    if (editingFilterId) {
      setJsFilters((fs) => fs.map((x) => (x.id === editingFilterId ? { ...x, code } : x)));
    } else {
      setJsFilters((fs) => [...fs, { id: crypto.randomUUID(), code, enabled: true }]);
    }
    setJsDraft("");
    setEditingFilterId(null);
    setJsModalOpen(false);
  };

  useEffect(() => {
    if (tabTopic) setTopic(tabTopic);
  }, [tabTopic]);

  const partitions = meta.data?.topics.find((t) => t.name === topic)?.partitions ?? 0;
  const topicOptions = (meta.data?.topics ?? [])
    .filter((t) => !t.internal)
    .map((t) => ({ value: t.name, hint: `${t.partitions}p` }));

  const load = async () => {
    if (!conn || !topic) {
      showToast("Pick a topic", "Choose a topic to load messages from.", "warn");
      return;
    }
    if (from === "offset" && fromOffset.trim() === "") {
      showToast("Offset required", "Enter a start offset.", "warn");
      return;
    }
    if (from === "timestamp" && !fromTime) {
      showToast("Time required", "Pick a start date/time.", "warn");
      return;
    }
    setLoading(true);
    try {
      const msgs = await consumeMessages(conn, topic, {
        limit,
        partition,
        from,
        offset: from === "offset" ? Number(fromOffset) : null,
        timestampMs: from === "timestamp" ? new Date(fromTime).getTime() : null,
      });
      setMessages(msgs);
      renameTab(tabId, topic);
    } catch (err) {
      showToast("Consume failed", String(err), "err");
    } finally {
      setLoading(false);
    }
  };

  // feed field paths from loaded payloads into the JS-filter autocomplete
  useEffect(() => {
    if (!active || !messages?.length) return;
    const paths = new Set<string>();
    for (const m of messages.slice(0, 50)) collectPaths(tryParse(m.payload), "", paths, 0);
    setMessageFields([...paths]);
  }, [messages, active]);

  // ⌘↵ / titlebar play bump runNonce — only the active tab loads
  const runNonce = useApp((s) => s.runNonce);
  const prevNonce = useRef(runNonce);
  useEffect(() => {
    if (runNonce !== prevNonce.current) {
      prevNonce.current = runNonce;
      if (active && !loading) void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runNonce, active]);

  // ponytail: getPath-based projection, no wildcard/[$] support — port normalizeJson if needed
  const paths = useMemo(
    () => colsInput.split(",").map((s) => s.trim()).filter(Boolean),
    [colsInput],
  );

  const activeFns = useMemo(() => {
    const fns: FilterFn[] = [];
    for (const f of jsFilters) {
      if (!f.enabled) continue;
      try {
        fns.push(compileFilter(f.code));
      } catch {
        // validated on add; ignore if it somehow breaks later
      }
    }
    return fns;
  }, [jsFilters]);

  const q = filter.trim().toLowerCase();
  const needJson = paths.length > 0 || activeFns.length > 0;
  const rows: Row[] = useMemo(
    () =>
      (messages ?? [])
        .filter(
          (m) =>
            !q ||
            m.payload.toLowerCase().includes(q) ||
            (m.key ?? "").toLowerCase().includes(q),
        )
        .map((m) => ({ ...m, json: needJson ? tryParse(m.payload) : undefined }))
        .filter((r) =>
          activeFns.every((fn) => {
            try {
              return !!fn(r.json, r.key, r.partition, r.offset, r.timestamp, Object.fromEntries(r.headers));
            } catch {
              return false; // filter threw for this message — exclude it, like Redpanda console
            }
          }),
        ),
    [messages, q, needJson, activeFns],
  );

  const { sorted, sort, cycleSort } = useSortedRows<Row>(rows, (r, col) => {
    switch (col) {
      case "partition": return r.partition;
      case "offset": return r.offset;
      case "timestamp": return r.timestamp;
      case "key": return r.key;
      default: return formatValue(getPath(r.json, stripValue(col)));
    }
  });

  if (mode === "search") {
    return (
      <>
        <FullTopicSearch
          active={active}
          initialTopic={topic}
          jsFilters={jsFilters}
          onEditFilters={openNewFilter}
          onBrowse={() => setMode("browse")}
        />
        {jsModalOpen && (
          <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setJsModalOpen(false); }}>
            <div className="prompt-dialog" style={{ width: 620, maxWidth: "90vw" }}>
              <strong>{editingFilterId ? "Edit JS filter" : "JS message filter"}</strong>
              <p className="prompt-dialog-msg">Expression or body with <code>return</code> over (value, key, partition, offset, timestamp, headers).</p>
              <CodeInput value={jsDraft} onChange={setJsDraft} vimStatusRef={vimStatusRef} height={140} />
              <div className="prompt-dialog-foot">
                <span ref={vimStatusRef} className="vim-status" style={{ flex: 1, textAlign: "left" }} />
                <ToolButton onClick={() => setJsModalOpen(false)}>Cancel</ToolButton>
                <ToolButton variant="primary" disabled={!jsDraft.trim()} onClick={saveJsFilter}><Icon name="plus" /> Add filter</ToolButton>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <section
      className={`content indexes-view ${active ? "active" : ""}`}
      style={{ gridTemplateRows: "46px 46px minmax(0, 1fr)" }}
    >
      <LoadingBar active={loading} />
      {/* row 1 — source: topic / partition / limit / order */}
      <div className="index-searchbar" style={{ gridTemplateColumns: `minmax(200px, 300px) auto auto auto${from === "offset" || from === "timestamp" ? " auto" : ""} 1fr auto` }}>
        <Combobox
          value={topic}
          options={topicOptions}
          placeholder="— topic —"
          onChange={(v) => {
            setTopic(v);
            setMessages(null);
            setPartition(null);
          }}
        />
        <select
          className="index-search"
          style={{ width: 110 }}
          value={partition ?? -1}
          onChange={(e) => setPartition(Number(e.target.value) < 0 ? null : Number(e.target.value))}
        >
          <option value={-1}>all parts</option>
          {Array.from({ length: partitions }, (_, i) => (
            <option key={i} value={i}>p{i}</option>
          ))}
        </select>
        <select className="index-search" style={{ width: 100 }} value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[50, 100, 250, 500, 1000].map((n) => <option key={n} value={n}>{n} msgs</option>)}
        </select>
        <select className="index-search" style={{ width: 130 }} value={from} onChange={(e) => setFrom(e.target.value as ConsumeFrom)}>
          <option value="end">newest</option>
          <option value="start">oldest</option>
          <option value="offset">from offset</option>
          <option value="timestamp">from time</option>
        </select>
        {from === "offset" && (
          <input
            className="index-search"
            style={{ width: 130 }}
            type="number"
            min={0}
            placeholder="start offset"
            value={fromOffset}
            onChange={(e) => setFromOffset(e.target.value)}
          />
        )}
        {from === "timestamp" && (
          <button
            type="button"
            className="index-search"
            style={{ width: 200, textAlign: "left", font: "0.9231rem var(--font-mono)", color: fromTime ? "var(--text)" : "var(--text-3)" }}
            title="Pick start date/time"
            onClick={() => setTimeModalOpen(true)}
          >
            {fromTime ? fromTime.replace("T", " ") : "pick time…"}
          </button>
        )}
        <ToolButton title="Scan the complete topic snapshot" onClick={() => setMode("search")}>
          <Icon name="search" /> Full search
        </ToolButton>
        <Badge>{messages ? `${rows.length}/${messages.length}` : "0"}</Badge>
      </div>
      {/* row 2 — search + column projection + JS filters */}
      <div className="index-searchbar" style={{ gridTemplateColumns: "minmax(220px, 1fr) minmax(180px, 280px) auto minmax(0, 1fr)" }}>
        <input
          className="index-search"
          placeholder="Search key or payload"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <input
          className="index-search"
          placeholder="Columns: value.user.id, value.status"
          title="Comma-separated JSON paths projected from the payload into table columns"
          value={colsInput}
          onChange={(e) => setColsInput(e.target.value)}
        />
        <ToolButton title="Add a Redpanda-style JS filter" onClick={openNewFilter}>
          <Icon name="filter" /> JS filter
        </ToolButton>
        <div className="path-chip-row">
          {jsFilters.map((f) => (
            <span
              key={f.id}
              className="path-chip"
              style={f.enabled ? undefined : { opacity: 0.45, filter: "grayscale(1)" }}
              title={`${f.code} — click to ${f.enabled ? "disable" : "enable"}`}
              onClick={() =>
                setJsFilters((fs) => fs.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x)))
              }
            >
              <span
                title="Edit filter"
                style={{ display: "inline-flex" }}
                onClick={(e) => {
                  e.stopPropagation();
                  openEditFilter(f);
                }}
              >
                <Icon name="settings" size={12} />
              </span>
              {f.code.length > 48 ? `${f.code.slice(0, 48)}…` : f.code}
              <span
                title="Remove filter"
                style={{ display: "inline-flex" }}
                onClick={(e) => {
                  e.stopPropagation();
                  setJsFilters((fs) => fs.filter((x) => x.id !== f.id));
                }}
              >
                <Icon name="x" size={12} />
              </span>
            </span>
          ))}
        </div>
      </div>
      {timeModalOpen && (
        <DateTimeModal
          value={fromTime}
          onClose={() => setTimeModalOpen(false)}
          onApply={(v) => {
            setFromTime(v);
            setTimeModalOpen(false);
          }}
        />
      )}
      {jsModalOpen && (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setJsModalOpen(false); }}>
          <div className="prompt-dialog" style={{ width: 620, maxWidth: "90vw" }}>
            <strong>{editingFilterId ? "Edit JS filter" : "JS message filter"}</strong>
            <p className="prompt-dialog-msg">
              Expression or body with <code>return</code> over (value, key, partition, offset, timestamp, headers) — message passes when truthy. Example: <code>value.status === "paid"</code>
            </p>
            <CodeInput value={jsDraft} onChange={setJsDraft} vimStatusRef={vimStatusRef} height={140} />
            <div className="prompt-dialog-foot">
              <span ref={vimStatusRef} className="vim-status" style={{ flex: 1, textAlign: "left" }} />
              <ToolButton onClick={() => setJsModalOpen(false)}>Cancel</ToolButton>
              <ToolButton variant="primary" disabled={!jsDraft.trim()} onClick={saveJsFilter}>
                <Icon name={editingFilterId ? "save" : "plus"} /> {editingFilterId ? "Save" : "Add filter"}
              </ToolButton>
            </div>
          </div>
        </div>
      )}
      <div className="index-table-wrap">
        {!conn && <div className="empty-note">Connect to a cluster first.</div>}
        {loading && <div className="empty-note">Loading messages…</div>}
        {conn && messages === null && !loading && (
          <div className="empty-note">Pick a topic and press ⌘↵ (or the play button up top) — messages are fetched read-only, no offsets are committed.</div>
        )}
        {messages !== null && (
          <table>
            <thead>
              <tr>
                <SortTh col="partition" sort={sort} onSort={cycleSort} style={{ width: 60 }}>Part</SortTh>
                <SortTh col="offset" sort={sort} onSort={cycleSort} style={{ width: 100 }}>Offset</SortTh>
                <SortTh col="timestamp" sort={sort} onSort={cycleSort} style={{ width: 180 }}>Timestamp</SortTh>
                <SortTh col="key" sort={sort} onSort={cycleSort} style={{ width: 140 }}>Key</SortTh>
                {paths.map((p) => (
                  <SortTh key={p} col={p} sort={sort} onSort={cycleSort} style={{ width: 160 }}>{stripValue(p)}</SortTh>
                ))}
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {(sorted ?? []).map((m) => (
                <tr
                  key={`${m.partition}-${m.offset}`}
                  className={
                    selectedMsg && selectedMsg.partition === m.partition && selectedMsg.offset === m.offset && selectedMsg.topic === m.topic
                      ? "selected"
                      : ""
                  }
                  onClick={() => selectMsg(m)}
                >
                  <td>{m.partition}</td>
                  <td>{m.offset}</td>
                  <td>{m.timestamp ? new Date(m.timestamp).toISOString().replace("T", " ").slice(0, 19) : "—"}</td>
                  <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{m.key ?? "—"}</td>
                  {paths.map((p) => (
                    <td key={p} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                      {formatValue(getPath(m.json, stripValue(p)))}
                    </td>
                  ))}
                  <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>{m.payload.slice(0, 500)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5 + paths.length}>No messages{q ? " match the filter" : ""}.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
