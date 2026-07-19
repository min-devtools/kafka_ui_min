import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Badge } from "../../ui/Badge";
import { ToolButton } from "../../ui/ToolButton";
import { Combobox } from "../../ui/Combobox";
import { CodeInput } from "../../ui/CodeInput";
import { DateTimeModal } from "../../ui/DateTimeModal";
import { SortTh } from "../../ui/SortTh";
import { Icon } from "../../ui/Icon";
import { LoadingBar } from "../../ui/LoadingBar";
import { SectionVeil } from "../../ui/SectionVeil";
import { Pagination } from "../../ui/Pagination";
import { useSortedRows } from "../../lib/useSort";
import { useApp } from "../../store";
import { useActiveConnection, useClusterMeta } from "../../lib/queries";
import { consumeMessages, type ConsumeFrom } from "../../lib/kafka";
import { setMessageFields } from "../../lib/monaco";
import { formatTs, formatValue, getPath, valueClass } from "../../lib/format";
import { isTypingTarget } from "../../lib/dom";
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

type Row = MessageRec & { json?: unknown };

/** "value.user.id" → "user.id"; bare "user.id" also accepted */
const stripValue = (path: string) => (path.startsWith("value.") ? path.slice(6) : path);

function tryParse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/** JS filters are saved per topic so they survive tab close / app restart. */
function loadJsFilters(topic: string): JsFilter[] {
  if (!topic) return [];
  try {
    const raw = localStorage.getItem(`kafkamin:jsfilters:${topic}`);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter((f): f is JsFilter => typeof f?.id === "string" && typeof f?.code === "string")
      : [];
  } catch {
    return [];
  }
}

export function MessagesView({ tabId, active }: { tabId: string; active: boolean }) {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const tabTopic = useApp((s) => s.msgTabs[tabId]?.topic ?? "");
  const selectedMsg = useApp((s) => s.selectedMsg);
  const selectMsg = useApp((s) => s.selectMsg);
  const showToast = useApp((s) => s.showToast);
  const renameTab = useApp((s) => s.renameTab);

  const [topic, setTopic] = useState(tabTopic);
  const [partition, setPartition] = useState<number | null>(null);
  const [limitStr, setLimitStr] = useState("100");
  const limit = Math.min(10_000, Math.max(1, parseInt(limitStr, 10) || 100));
  const [from, setFrom] = useState<ConsumeFrom>("end");
  const [fromOffset, setFromOffset] = useState("");
  const [fromTime, setFromTime] = useState("");
  const [timeModalOpen, setTimeModalOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [colsInput, setColsInput] = useState("");
  const [messages, setMessages] = useState<MessageRec[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [jsFilters, setJsFilters] = useState<JsFilter[]>(() => loadJsFilters(tabTopic));
  const [mode, setMode] = useState<"browse" | "search">("browse");
  const [jsDraft, setJsDraft] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const vimStatusRef = useRef<HTMLSpanElement>(null);

  const [jsModalOpen, setJsModalOpen] = useState(false);
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null);

  // write-through: state + per-topic localStorage stay in sync
  const updateJsFilters = (fn: (fs: JsFilter[]) => JsFilter[]) =>
    setJsFilters((fs) => {
      const next = fn(fs);
      if (topic) localStorage.setItem(`kafkamin:jsfilters:${topic}`, JSON.stringify(next));
      return next;
    });

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
      updateJsFilters((fs) => fs.map((x) => (x.id === editingFilterId ? { ...x, code } : x)));
    } else {
      updateJsFilters((fs) => [...fs, { id: crypto.randomUUID(), code, enabled: true }]);
    }
    setJsDraft("");
    setEditingFilterId(null);
    setJsModalOpen(false);
  };

  useEffect(() => {
    if (tabTopic) setTopic(tabTopic);
  }, [tabTopic]);

  // filters follow the topic
  const filtersTopicRef = useRef(tabTopic);
  useEffect(() => {
    if (filtersTopicRef.current === topic) return;
    filtersTopicRef.current = topic;
    setJsFilters(loadJsFilters(topic));
  }, [topic]);

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
      const res = await consumeMessages(conn, topic, {
        limit,
        partition,
        from,
        offset: from === "offset" ? Number(fromOffset) : null,
        timestampMs: from === "timestamp" ? new Date(fromTime).getTime() : null,
      });
      setMessages(res.messages);
      setPage(1);
      if (res.partial) {
        showToast("Partial result", `Broker was slow — ${res.messages.length} messages fetched before the 10s timeout.`, "warn");
      }
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

  // auto-load newest messages once per topic when the tab is visible
  const autoLoadedTopic = useRef<string | null>(null);
  // re-arm on tab leave: a failed attempt (broker down) retries next visit instead of sticking forever
  useEffect(() => {
    if (!active) autoLoadedTopic.current = null;
  }, [active]);
  useEffect(() => {
    if (!active || !conn || !topic || loading || messages !== null) return;
    if (autoLoadedTopic.current === topic) return; // one attempt per topic — no retry loop on error
    autoLoadedTopic.current = topic;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, conn, topic, messages, loading]);

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

  // deferred: typing in the filter box stays responsive while the 10k-row list re-filters
  const deferredFilter = useDeferredValue(filter);
  const q = deferredFilter.trim().toLowerCase();
  const needJson = paths.length > 0 || activeFns.length > 0;
  // parse once per load, not on every filter/sort recompute
  const parsed = useMemo(() => (messages ?? []).map((m) => tryParse(m.payload)), [messages]);
  const rows: Row[] = useMemo(
    () =>
      (messages ?? [])
        .map((m, i): Row => (needJson ? { ...m, json: parsed[i] } : m))
        .filter(
          (m) =>
            !q ||
            m.payload.toLowerCase().includes(q) ||
            (m.key ?? "").toLowerCase().includes(q),
        )
        .filter((r) =>
          activeFns.every((fn) => {
            try {
              return !!fn(r.json, r.key, r.partition, r.offset, r.timestamp, Object.fromEntries(r.headers));
            } catch {
              return false; // filter threw for this message — exclude it, like Redpanda console
            }
          }),
        ),
    [messages, parsed, q, needJson, activeFns],
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

  const totalPages = Math.max(1, Math.ceil((sorted?.length ?? 0) / pageSize));
  useEffect(() => setPage((v) => Math.min(v, totalPages)), [totalPages]);
  const paged = useMemo(
    () => (sorted ?? []).slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  // ↑/↓ walk the selection through the (sorted, filtered) rows; page follows
  useEffect(() => {
    if (!active || mode !== "browse") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (isTypingTarget(e.target) || !sorted?.length) return;
      e.preventDefault();
      const sel = useApp.getState().selectedMsg;
      const idx = sel
        ? sorted.findIndex((r) => r.partition === sel.partition && r.offset === sel.offset && r.topic === sel.topic)
        : -1;
      const next = e.key === "ArrowDown" ? Math.min(sorted.length - 1, idx + 1) : Math.max(0, idx - 1);
      selectMsg(sorted[next]);
      setPage(Math.floor(next / pageSize) + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, mode, sorted, pageSize, selectMsg]);

  const copyNdjson = async () => {
    const lines = (sorted ?? []).map(({ json: _json, ...m }) => JSON.stringify(m)).join("\n");
    await writeText(lines);
    showToast("Copied", `${sorted?.length ?? 0} filtered messages as NDJSON.`);
  };

  const jsModal = jsModalOpen && (
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
  );

  if (mode === "search") {
    return (
      <>
        <FullTopicSearch
          active={active}
          initialTopic={topic}
          initialText={filter.trim()}
          jsFilters={jsFilters}
          onEditFilters={openNewFilter}
          onBrowse={() => setMode("browse")}
        />
        {jsModal}
      </>
    );
  }

  return (
    <section
      className={`content indexes-view ${active ? "active" : ""}`}
      style={{ gridTemplateRows: messages !== null ? "46px 46px minmax(0, 1fr) auto" : "46px 46px minmax(0, 1fr)" }}
    >
      <LoadingBar active={loading} />
      {/* row 1 — source: topic / partition / limit / order */}
      <div className="index-searchbar" style={{ gridTemplateColumns: `minmax(260px, 460px) auto auto auto${from === "offset" || from === "timestamp" ? " auto" : ""} 1fr auto` }}>
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
        {/* Combobox instead of native datalist — WKWebView datalist popups stick open / hide options */}
        <div style={{ width: 110 }} title="Messages to fetch — pick a preset or type any number (1–10000)">
          <Combobox
            freeText
            value={limitStr}
            options={[50, 100, 250, 500, 1000, 5000, 10000].map((n) => ({ value: String(n) }))}
            onChange={(v) => setLimitStr(v.replace(/[^0-9]/g, "") || "100")}
          />
        </div>
        <select className="index-search" style={{ width: 140 }} value={from} onChange={(e) => setFrom(e.target.value as ConsumeFrom)}>
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
      <div className="index-searchbar" style={{ gridTemplateColumns: "minmax(220px, 1fr) minmax(180px, 280px) auto auto minmax(0, 1fr)" }}>
        <input
          className="index-search"
          placeholder={`Filter ${messages?.length ?? 0} loaded messages (key/payload)`}
          title="Filters only the messages already loaded in this view — use Full search to scan the whole topic"
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
        <ToolButton title="Copy the filtered rows to the clipboard as NDJSON" disabled={!rows.length} onClick={() => void copyNdjson()}>
          <Icon name="copy" /> NDJSON
        </ToolButton>
        <div className="path-chip-row">
          {jsFilters.map((f) => (
            <span
              key={f.id}
              className="path-chip"
              style={f.enabled ? undefined : { opacity: 0.45, filter: "grayscale(1)" }}
              title={`${f.code} — click to ${f.enabled ? "disable" : "enable"}`}
              onClick={() =>
                updateJsFilters((fs) => fs.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x)))
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
                  updateJsFilters((fs) => fs.filter((x) => x.id !== f.id));
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
      {jsModal}
      <div className="index-table-wrap">
        {/* initial load only — reloads with a table already on screen keep the LoadingBar */}
        <SectionVeil on={loading && messages === null} label="Loading messages…" />
        {!conn && <div className="empty-note">Connect to a cluster first.</div>}
        {conn && messages === null && !loading && (
          <div className="empty-note">Pick a topic — newest messages load automatically (⌘↵ or the play button reloads). Fetches are read-only, no offsets are committed.</div>
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
              {paged.map((m) => (
                <tr
                  key={`${m.partition}-${m.offset}`}
                  className={
                    selectedMsg && selectedMsg.partition === m.partition && selectedMsg.offset === m.offset && selectedMsg.topic === m.topic
                      ? "selected"
                      : ""
                  }
                  onClick={() => selectMsg(m)}
                >
                  <td className="cell-number">{m.partition}</td>
                  <td className="cell-number">{m.offset}</td>
                  <td className="cell-date">{formatTs(m.timestamp)}</td>
                  <td className="cell-id" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{m.key ?? "—"}</td>
                  {paths.map((p) => {
                    const v = getPath(m.json, stripValue(p));
                    return (
                      <td key={p} className={`cell-${valueClass(p, v)}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                        {formatValue(v)}
                      </td>
                    );
                  })}
                  <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 480 }}>{m.payload.slice(0, 500)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5 + paths.length}>
                    No messages{q ? ` match "${deferredFilter.trim()}" in the ${messages?.length ?? 0} loaded here` : ""}.{" "}
                    {q && (
                      <ToolButton onClick={() => setMode("search")}>
                        <Icon name="search" /> Search entire topic for “{deferredFilter.trim()}”
                      </ToolButton>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      {messages !== null && (
        <div className="full-search-foot">
          <span>{rows.length} filtered · {messages.length} loaded · times shown in local timezone</span>
          <Pagination page={page} totalPages={totalPages} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
        </div>
      )}
    </section>
  );
}
