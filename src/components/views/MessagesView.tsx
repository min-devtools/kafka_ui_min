import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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
import { consumeMessages, startLiveMessages, stopLiveMessages, type ConsumeFrom } from "../../lib/kafka";
import { setMessageFields } from "../../lib/monaco";
import { formatTs, formatValue, getPath, valueClass } from "../../lib/format";
import { isTypingTarget } from "../../lib/dom";
import type { LiveBatch, LiveFinished, MessageRec } from "../../lib/types";
import { FullTopicSearch } from "./FullTopicSearch";
import {
  compileFilter,
  shouldCloseFilterModalOnEscape,
  type FilterFn,
  type JsFilter,
} from "../../lib/messageFilter";
import { JsFilterBar } from "./JsFilterBar";

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
type MessageMode = "browse" | "live" | "search";

const LIVE_BUFFER_CAP = 5_000;

/** "value.user.id" → "user.id"; bare "user.id" also accepted */
const stripValue = (path: string) => (path.startsWith("value.") ? path.slice(6) : path);

function tryParse(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

/** JS filters are saved per connection/topic so identically named topics do not leak across clusters. */
function loadJsFilters(connId: string | undefined, topic: string): JsFilter[] {
  if (!connId || !topic) return [];
  try {
    const raw = localStorage.getItem(`kafkamin:jsfilters:${connId}:${topic}`);
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
  const setMessagesTabTopic = useApp((s) => s.setMessagesTabTopic);
  const vimMode = useApp((s) => s.vimMode);

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
  const [jsFilters, setJsFilters] = useState<JsFilter[]>(() => loadJsFilters(conn?.id, tabTopic));
  const [mode, setMode] = useState<MessageMode>("browse");
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveDropped, setLiveDropped] = useState(0);
  const [jsDraft, setJsDraft] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const vimStatusRef = useRef<HTMLSpanElement>(null);
  const vimEditorModeRef = useRef("normal");
  const liveIdRef = useRef<string | null>(null);
  const liveUnlistenRef = useRef<UnlistenFn[]>([]);
  const setTabRunning = useApp((s) => s.setTabRunning);
  const [jsModalOpen, setJsModalOpen] = useState(false);
  const [editingFilterId, setEditingFilterId] = useState<string | null>(null);

  useEffect(() => {
    setTabRunning(tabId, liveRunning);
    return () => setTabRunning(tabId, false);
  }, [tabId, liveRunning, setTabRunning]);

  // write-through: state + per-topic localStorage stay in sync
  const updateJsFilters = (fn: (fs: JsFilter[]) => JsFilter[]) =>
    setJsFilters((fs) => {
      const next = fn(fs);
      if (conn && topic) {
        localStorage.setItem(`kafkamin:jsfilters:${conn.id}:${topic}`, JSON.stringify(next));
      }
      return next;
    });

  const openNewFilter = () => {
    setEditingFilterId(null);
    setJsDraft("");
    vimEditorModeRef.current = "normal";
    setJsModalOpen(true);
  };

  const openEditFilter = (f: JsFilter) => {
    setEditingFilterId(f.id);
    setJsDraft(f.code);
    vimEditorModeRef.current = "normal";
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

  // Esc closes the JS filter modal; Enter saves — but not while typing inside the Monaco
  // editor, where Enter must insert a newline (and drive vim-mode keys). Capture phase so
  // this swallows the key before app-level shortcuts, same as Dialog.tsx.
  useEffect(() => {
    if (!jsModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!shouldCloseFilterModalOnEscape(vimMode, vimEditorModeRef.current)) return;
        e.preventDefault();
        e.stopPropagation();
        setJsModalOpen(false);
      } else if (e.key === "Enter" && !isTypingTarget(e.target) && jsDraft.trim()) {
        e.preventDefault();
        e.stopPropagation();
        saveJsFilter();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [jsModalOpen, jsDraft, saveJsFilter, vimMode]);

  useEffect(() => {
    setTopic(tabTopic);
  }, [tabTopic]);

  // filters follow the topic
  const filtersTopicRef = useRef(tabTopic);
  useEffect(() => {
    if (filtersTopicRef.current === topic) return;
    filtersTopicRef.current = topic;
    setJsFilters(loadJsFilters(conn?.id, topic));
  }, [conn?.id, topic]);

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

  const cleanupLiveListeners = () => {
    liveUnlistenRef.current.forEach((unlisten) => unlisten());
    liveUnlistenRef.current = [];
  };

  const stopLive = () => {
    const liveId = liveIdRef.current;
    liveIdRef.current = null;
    setLiveRunning(false);
    cleanupLiveListeners();
    if (liveId) void stopLiveMessages(liveId);
  };

  const startLive = async () => {
    if (!conn || !topic) {
      showToast("Pick a topic", "Choose a topic before starting Live.", "warn");
      return;
    }
    stopLive();
    const liveId = crypto.randomUUID();
    liveIdRef.current = liveId;
    setMessages([]);
    setPage(1);
    setLiveDropped(0);
    setLiveRunning(true);
    selectMsg(null);

    const [offBatch, offFinished] = await Promise.all([
      listen<LiveBatch>("kafka-live-batch", ({ payload }) => {
        if (payload.liveId !== liveId || liveIdRef.current !== liveId) return;
        setMessages((current) => {
          const next = [...(current ?? []), ...payload.messages];
          const overflow = Math.max(0, next.length - LIVE_BUFFER_CAP);
          if (overflow) setLiveDropped((count) => count + overflow);
          const kept = overflow ? next.slice(overflow) : next;
          setPage(Math.max(1, Math.ceil(kept.length / pageSize)));
          return kept;
        });
      }),
      listen<LiveFinished>("kafka-live-finished", ({ payload }) => {
        if (payload.liveId !== liveId || liveIdRef.current !== liveId) return;
        liveIdRef.current = null;
        setLiveRunning(false);
        window.setTimeout(cleanupLiveListeners, 0);
        if (payload.error) showToast("Live stopped", payload.error, "err");
      }),
    ]);
    liveUnlistenRef.current = [offBatch, offFinished];

    try {
      await startLiveMessages(conn, liveId, topic, partition);
      renameTab(tabId, topic);
    } catch (err) {
      if (liveIdRef.current === liveId) {
        liveIdRef.current = null;
        setLiveRunning(false);
        cleanupLiveListeners();
      }
      showToast("Live failed", String(err), "err");
    }
  };

  useEffect(() => () => {
    const liveId = liveIdRef.current;
    liveIdRef.current = null;
    liveUnlistenRef.current.forEach((unlisten) => unlisten());
    liveUnlistenRef.current = [];
    if (liveId) void stopLiveMessages(liveId);
  }, []);

  const switchMode = (next: MessageMode) => {
    if (mode === "live" && next !== "live") {
      stopLive();
      setMessages(null);
    }
    setMode(next);
    selectMsg(null);
    if (next === "live") {
      setMessages(topic ? [] : null);
      setPage(1);
      setLiveDropped(0);
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
    if (mode !== "browse" || !active || !conn || !topic || loading || messages !== null) return;
    if (autoLoadedTopic.current === topic) return; // one attempt per topic — no retry loop on error
    autoLoadedTopic.current = topic;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, active, conn, topic, messages, loading]);

  // ⌘↵ bumps runNonce — only the active tab responds with its current mode action
  const runNonce = useApp((s) => s.runNonce);
  const prevNonce = useRef(runNonce);
  useEffect(() => {
    if (runNonce !== prevNonce.current) {
      prevNonce.current = runNonce;
      if (mode === "browse" && active && !loading) void load();
      if (mode === "live" && active) {
        if (liveRunning) stopLive();
        else void startLive();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runNonce, active, mode, liveRunning]);

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
    if (!active || mode === "search") return;
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

  const modeSwitch = (
    <div className="message-mode-tabs" role="tablist" aria-label="Message view mode">
      <button type="button" role="tab" aria-selected={mode === "browse"} className={mode === "browse" ? "active" : ""} onClick={() => switchMode("browse")}>
        <Icon name="rows" size={13} />
        <span>Browse</span>
      </button>
      <button type="button" role="tab" aria-selected={mode === "live"} className={mode === "live" ? "active" : ""} onClick={() => switchMode("live")}>
        <Icon name="zap" size={13} />
        <span>Live</span>
      </button>
      <button type="button" role="tab" aria-selected={mode === "search"} className={mode === "search" ? "active" : ""} onClick={() => switchMode("search")}>
        <Icon name="search" size={13} />
        <span>FullSearch</span>
      </button>
    </div>
  );

  const jsModal = jsModalOpen && (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) setJsModalOpen(false); }}>
      <div className="prompt-dialog" style={{ width: 620, maxWidth: "90vw" }}>
        <strong>{editingFilterId ? "Edit JS filter" : "JS message filter"}</strong>
        <p className="prompt-dialog-msg">
          Expression or body with <code>return</code> over (value, key, partition, offset, timestamp, headers) — message passes when truthy. Example: <code>value.status === "paid"</code>
        </p>
        <CodeInput
          value={jsDraft}
          onChange={setJsDraft}
          vimStatusRef={vimStatusRef}
          onVimModeChange={(editorMode) => { vimEditorModeRef.current = editorMode; }}
          height={140}
        />
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
          tabId={tabId}
          active={active}
          initialTopic={topic}
          initialText={filter.trim()}
          jsFilters={jsFilters}
          modeSwitch={modeSwitch}
          onAddFilter={openNewFilter}
          onToggleFilter={(item) => updateJsFilters((items) => items.map((filterItem) => (
            filterItem.id === item.id ? { ...filterItem, enabled: !filterItem.enabled } : filterItem
          )))}
          onEditFilter={openEditFilter}
          onRemoveFilter={(item) => updateJsFilters((items) => items.filter((filterItem) => filterItem.id !== item.id))}
          onTopicChange={(nextTopic) => {
            setTopic(nextTopic);
            setMessagesTabTopic(tabId, nextTopic);
            setMessages(null);
            setPartition(null);
            selectMsg(null);
          }}
        />
        {jsModal}
      </>
    );
  }

  return (
    <section
      className={`content indexes-view ${active ? "active" : ""}`}
      style={{
        gridTemplateRows: topic
          ? messages !== null
            ? "46px 46px auto minmax(0, 1fr) auto"
            : "46px 46px auto minmax(0, 1fr)"
          : "46px minmax(0, 1fr)",
      }}
    >
      <LoadingBar active={mode === "browse" && loading} />
      <div className="message-sourcebar">
        <Combobox
          value={topic}
          options={topicOptions}
          placeholder="— topic —"
          onChange={(v) => {
            if (liveRunning) stopLive();
            setTopic(v);
            setMessagesTabTopic(tabId, v);
            selectMsg(null);
            setMessages(mode === "live" ? [] : null);
            setPartition(null);
          }}
        />
        {topic && (
          <>
            <select
              className="index-search"
              style={{ width: 110 }}
              value={partition ?? -1}
              onChange={(e) => {
                if (liveRunning) stopLive();
                setPartition(Number(e.target.value) < 0 ? null : Number(e.target.value));
              }}
            >
              <option value={-1}>all parts</option>
              {Array.from({ length: partitions }, (_, i) => (
                <option key={i} value={i}>p{i}</option>
              ))}
            </select>
            {mode === "browse" && (
              <>
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
                  <input className="index-search" style={{ width: 130 }} type="number" min={0} placeholder="start offset" value={fromOffset} onChange={(e) => setFromOffset(e.target.value)} />
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
              </>
            )}
            {mode === "live" && <span className="live-tail-note">Only new messages after Start live</span>}
            <span className="message-source-spacer" />
            <Badge>{mode === "live" ? (liveRunning ? "Listening" : "Stopped") : messages ? `${rows.length}/${messages.length}` : "0"}</Badge>
          </>
        )}
        {!topic && <span className="message-source-spacer" />}
        {modeSwitch}
      </div>
      {topic && (
        <div className="message-querybar">
          <input
            className="index-search"
            placeholder={`Filter ${messages?.length ?? 0} ${mode === "live" ? "live" : "loaded"} messages (key/payload)`}
            title="Filters only messages currently buffered in this view"
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
          {mode === "live" && liveDropped > 0 && <Badge>{liveDropped} older dropped</Badge>}
          <ToolButton title="Copy the filtered rows to the clipboard as NDJSON" disabled={!rows.length} onClick={() => void copyNdjson()}>
            <Icon name="copy" /> NDJSON
          </ToolButton>
        </div>
      )}
      {topic && (
        <JsFilterBar
          filters={jsFilters}
          onAdd={openNewFilter}
          onToggle={(item) => updateJsFilters((items) => items.map((filterItem) => (
            filterItem.id === item.id ? { ...filterItem, enabled: !filterItem.enabled } : filterItem
          )))}
          onEdit={openEditFilter}
          onRemove={(item) => updateJsFilters((items) => items.filter((filterItem) => filterItem.id !== item.id))}
        />
      )}
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
        <SectionVeil on={mode === "browse" && loading && messages === null} label="Loading messages…" />
        {!conn && <div className="empty-note">Connect to a cluster first.</div>}
        {conn && !topic && (
          <div className="empty-note">Pick a topic. Browse and Live are read-only and never commit offsets.</div>
        )}
        {mode === "browse" && conn && topic && messages === null && !loading && (
          <div className="empty-note">Newest messages load automatically. Use Load or ⌘↵ to reload.</div>
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
                    {mode === "live" && !q
                      ? liveRunning
                        ? "Waiting for messages produced after Live started…"
                        : "Press Start live to tail only newly produced messages."
                      : <>No messages{q ? ` match "${deferredFilter.trim()}" in the ${messages?.length ?? 0} buffered here` : ""}.</>}{" "}
                    {mode === "browse" && q && (
                      <ToolButton onClick={() => switchMode("search")}>
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
          <span>
            {rows.length} filtered · {messages.length} {mode === "live" ? "buffered" : "loaded"}
            {mode === "live" && liveDropped > 0 ? ` · ${liveDropped} older dropped` : ""} · times shown in local timezone
          </span>
          <Pagination page={page} totalPages={totalPages} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
        </div>
      )}
    </section>
  );
}
