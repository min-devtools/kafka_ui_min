import { useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Badge } from "../../ui/Badge";
import { Combobox } from "../../ui/Combobox";
import { Icon } from "../../ui/Icon";
import { SortTh } from "../../ui/SortTh";
import { ToolButton } from "../../ui/ToolButton";
import { LoadingBar } from "../../ui/LoadingBar";
import { Pagination } from "../../ui/Pagination";
import { useSortedRows } from "../../lib/useSort";
import { cancelFullTopicSearch, setFullTopicSearchPaused, startFullTopicSearch } from "../../lib/kafka";
import { formatDocCount, formatTs } from "../../lib/format";
import { isTypingTarget } from "../../lib/dom";
import type { MessageRec, SearchBatch, SearchCondition, SearchFinished, SearchOperator, SearchProgress } from "../../lib/types";
import { useActiveConnection, useClusterMeta } from "../../lib/queries";
import { useApp } from "../../store";
import { compileFilter, type JsFilter } from "../../lib/messageFilter";

const RESULT_CAP = 10_000;
/** pages of matches kept buffered ahead of the viewed page before the scan idles */
const PREFETCH_PAGES = 2;
const OPERATORS: { value: SearchOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "notEquals", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "exists", label: "exists" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
];

type SearchState = "idle" | "running" | "completed" | "cancelled" | "failed";

export function FullTopicSearch({
  active,
  initialTopic,
  initialText = "",
  jsFilters,
  onEditFilters,
  onBrowse,
}: {
  active: boolean;
  initialTopic: string;
  initialText?: string;
  jsFilters: JsFilter[];
  onEditFilters: () => void;
  onBrowse: () => void;
}) {
  const conn = useActiveConnection();
  const meta = useClusterMeta();
  const selectMsg = useApp((s) => s.selectMsg);
  const selectedMsg = useApp((s) => s.selectedMsg);
  const showToast = useApp((s) => s.showToast);
  const [topic, setTopic] = useState(initialTopic);
  const [text, setText] = useState(initialText);
  const [conditions, setConditions] = useState<SearchCondition[]>([]);
  const [results, setResults] = useState<MessageRec[]>([]);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [usesJsFilter, setUsesJsFilter] = useState(false);
  const [state, setState] = useState<SearchState>("idle");
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const searchIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const filterFnsRef = useRef<ReturnType<typeof compileFilter>[]>([]);

  const topicOptions = (meta.data?.topics ?? []).filter((item) => !item.internal)
    .map((item) => ({ value: item.name, hint: `${item.partitions}p` }));

  const stopListeners = () => {
    unlistenRef.current.forEach((unlisten) => unlisten());
    unlistenRef.current = [];
  };

  const cancel = async () => {
    if (searchIdRef.current) await cancelFullTopicSearch(searchIdRef.current);
  };

  useEffect(() => () => {
    if (searchIdRef.current) void cancelFullTopicSearch(searchIdRef.current);
    stopListeners();
  }, []);

  const start = async () => {
    if (!conn || !topic) {
      showToast("Pick a topic", "Choose a topic to search.", "warn");
      return;
    }
    const invalid = conditions.find((condition) => {
      const field = condition.field.trim();
      const validField = ["key", "partition", "offset", "timestamp"].includes(field)
        || (/^headers\.[^.]+$/.test(field))
        || (/^value\.[^.]+(?:\.[^.]+)*$/.test(field));
      const numericValue = !["gt", "gte", "lt", "lte"].includes(condition.operator) || Number.isFinite(Number(condition.value));
      return !validField || (condition.operator !== "exists" && !condition.value.trim()) || !numericValue;
    });
    if (invalid) {
      showToast("Invalid condition", "Use value.field, key, partition, offset, timestamp, or headers.name. Numeric comparisons require a number.", "warn");
      return;
    }
    try {
      filterFnsRef.current = jsFilters.filter((filter) => filter.enabled).map((filter) => compileFilter(filter.code));
    } catch (err) {
      showToast("Invalid JS filter", String(err), "err");
      return;
    }
    if (searchIdRef.current) await cancelFullTopicSearch(searchIdRef.current);
    stopListeners();
    const searchId = crypto.randomUUID();
    searchIdRef.current = searchId;
    setResults([]);
    setAcceptedCount(0);
    setUsesJsFilter(filterFnsRef.current.length > 0);
    setProgress(null);
    setError(null);
    setPage(1);
    setPaused(false);
    pausedRef.current = false;
    setState("running");
    selectMsg(null);

    const [offBatch, offProgress, offFinished] = await Promise.all([
      listen<SearchBatch>("kafka-search-batch", ({ payload }) => {
        if (payload.searchId !== searchId) return;
        const accepted = payload.messages.filter((message) => {
          let value: unknown;
          try { value = JSON.parse(message.payload); } catch { value = undefined; }
          return filterFnsRef.current.every((fn) => {
            try {
              return !!fn(value, message.key, message.partition, message.offset, message.timestamp, Object.fromEntries(message.headers));
            } catch {
              return false;
            }
          });
        });
        setAcceptedCount((count) => count + accepted.length);
        setResults((current) => current.length >= RESULT_CAP ? current : [...current, ...accepted].slice(0, RESULT_CAP));
      }),
      listen<SearchProgress>("kafka-search-progress", ({ payload }) => {
        if (payload.searchId === searchId) setProgress(payload);
      }),
      listen<SearchFinished>("kafka-search-finished", ({ payload }) => {
        if (payload.searchId !== searchId) return;
        setState(payload.status);
        setError(payload.error);
        searchIdRef.current = null;
        window.setTimeout(stopListeners, 0);
      }),
    ]);
    unlistenRef.current = [offBatch, offProgress, offFinished];
    try {
      await startFullTopicSearch(
        conn,
        searchId,
        topic,
        text,
        conditions.map((condition) => ({ ...condition, field: condition.field.trim(), value: condition.value.trim() })),
      );
    } catch (err) {
      setState("failed");
      setError(String(err));
      searchIdRef.current = null;
      stopListeners();
    }
  };

  const { sorted, sort, cycleSort } = useSortedRows<MessageRec>(results, (r, col) => {
    switch (col) {
      case "partition": return r.partition;
      case "offset": return r.offset;
      case "timestamp": return r.timestamp;
      case "key": return r.key;
      default: return null;
    }
  });
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  useEffect(() => setPage((value) => Math.min(value, totalPages)), [totalPages]);
  const visible = useMemo(() => (sorted ?? []).slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

  // ↑/↓ walk the selection through the sorted results; page follows
  useEffect(() => {
    if (!active) return;
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
  }, [active, sorted, pageSize, selectMsg]);

  const copyNdjson = async () => {
    const lines = (sorted ?? []).map((m) => JSON.stringify(m)).join("\n");
    await writeText(lines);
    showToast("Copied", `${sorted?.length ?? 0} search results as NDJSON.`);
  };

  // Lazy scan: keep the backend scanning only until it has buffered enough matches
  // for the viewed page plus a lookahead, then idle it. Paging forward resumes —
  // the backend keeps its offsets, so nothing is re-scanned. A hidden tab pauses
  // too: an invisible scan would otherwise burn CPU with no indicator anywhere.
  useEffect(() => {
    const id = searchIdRef.current;
    if (state !== "running" || !id) return;
    const target = Math.min((page + PREFETCH_PAGES) * pageSize, RESULT_CAP);
    const shouldPause = !active || results.length >= target;
    if (shouldPause !== pausedRef.current) {
      pausedRef.current = shouldPause;
      setPaused(shouldPause);
      void setFullTopicSearchPaused(id, shouldPause);
    }
  }, [state, page, pageSize, results.length, active]);

  const percent = progress?.total ? Math.min(100, Math.round(progress.scanned / progress.total * 100)) : 0;
  const backendTruncatedForJs = usesJsFilter && (progress?.candidateMatches ?? 0) > RESULT_CAP;
  const matchCount = usesJsFilter ? acceptedCount : (progress?.candidateMatches ?? acceptedCount);
  const statusText = state === "running"
    ? paused
      ? `Idle · ${formatDocCount(matchCount)} matches ready · page forward to scan more`
      : `Scanning · ${percent}%`
    : state === "completed"
      ? matchCount ? `Completed · ${formatDocCount(matchCount)} matches` : "Completed · no matching messages"
      : state === "cancelled"
        ? `Cancelled · scanned ${percent}%`
        : state === "failed" ? `Failed · ${error ?? "unknown error"}` : "Ready to scan";

  return (
    <section className={`content full-search-view ${active ? "active" : ""}`}>
      <LoadingBar active={state === "running" && !paused} />
      <div className="full-search-head">
        <ToolButton onClick={onBrowse}><Icon name="arrow-left" /> Browse</ToolButton>
        <strong>Full topic search</strong>
        <span className="full-search-snapshot">Finite snapshot · scans every partition</span>
        <span />
        {state === "running"
          ? <ToolButton variant="danger" onClick={() => void cancel()}><Icon name="x" /> Cancel</ToolButton>
          : <ToolButton variant="primary" disabled={!conn} onClick={() => void start()}><Icon name="search" /> Search</ToolButton>}
      </div>
      <div className="full-search-controls">
        <Combobox value={topic} options={topicOptions} placeholder="— topic —" onChange={setTopic} />
        <input
          className="index-search"
          placeholder="Search key or payload — scans the whole topic, case-insensitive"
          title="Plain substring match against key and payload across every partition. Add Conditions or JS filters for field-level matching."
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <ToolButton onClick={() => setConditions((items) => [...items, { field: "value.", operator: "equals", value: "" }])}>
          <Icon name="plus" /> Condition
        </ToolButton>
        <ToolButton onClick={onEditFilters}><Icon name="code" /> JS filters ({jsFilters.filter((item) => item.enabled).length})</ToolButton>
      </div>
      {conditions.length > 0 && (
        <div className="full-search-conditions">
          {conditions.map((condition, index) => (
            <div className="full-condition" key={index}>
              <input className="index-search" aria-label={`Condition ${index + 1} field`} placeholder="value.user.id, key, headers.source" value={condition.field}
                onChange={(event) => setConditions((items) => items.map((item, i) => i === index ? { ...item, field: event.target.value } : item))} />
              <select className="index-search" value={condition.operator}
                onChange={(event) => setConditions((items) => items.map((item, i) => i === index ? { ...item, operator: event.target.value as SearchOperator } : item))}>
                {OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
              </select>
              <input className="index-search" disabled={condition.operator === "exists"} placeholder="value" value={condition.value}
                onChange={(event) => setConditions((items) => items.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />
              <ToolButton iconOnly title="Remove condition" onClick={() => setConditions((items) => items.filter((_, i) => i !== index))}><Icon name="x" /></ToolButton>
            </div>
          ))}
        </div>
      )}
      <div className="full-search-progress">
        <LoadingBar active bottom value={percent / 100} />
        <strong>{statusText}</strong>
        <span>{formatDocCount(progress?.scanned ?? 0)} / {formatDocCount(progress?.total ?? 0)} scanned</span>
        <span>{progress?.completedPartitions ?? 0} / {progress?.totalPartitions ?? 0} partitions</span>
        <span>{formatDocCount(Math.round(progress?.messagesPerSecond ?? 0))} msg/s</span>
        <span>{((progress?.elapsedMs ?? 0) / 1000).toFixed(1)}s</span>
        <Badge>{formatDocCount(matchCount)} matches</Badge>
      </div>
      <div className="index-table-wrap">
        {state === "idle" && <div className="empty-note">Search records a high-watermark snapshot, then scans it completely. New messages do not extend the search.</div>}
        {state !== "idle" && results.length === 0 && <div className="empty-note">{state === "running" ? "Scanning for matches…" : "No matching messages."}</div>}
        {results.length > 0 && (
          <table>
            <thead><tr>
              <SortTh col="partition" sort={sort} onSort={cycleSort} style={{ width: 60 }}>Part</SortTh>
              <SortTh col="offset" sort={sort} onSort={cycleSort} style={{ width: 100 }}>Offset</SortTh>
              <SortTh col="timestamp" sort={sort} onSort={cycleSort} style={{ width: 180 }}>Timestamp</SortTh>
              <SortTh col="key" sort={sort} onSort={cycleSort} style={{ width: 160 }}>Key</SortTh>
              <th>Payload</th>
            </tr></thead>
            <tbody>{visible.map((message) => (
              <tr key={`${message.partition}-${message.offset}`} className={selectedMsg?.partition === message.partition && selectedMsg.offset === message.offset ? "selected" : ""} onClick={() => selectMsg(message)}>
                <td className="cell-number">{message.partition}</td><td className="cell-number">{message.offset}</td>
                <td className="cell-date">{formatTs(message.timestamp)}</td>
                <td className="truncate-cell cell-id">{message.key ?? "—"}</td><td className="truncate-cell">{message.payload.slice(0, 500)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="full-search-foot">
        <span>{backendTruncatedForJs
          ? `Showing ${formatDocCount(results.length)} matches from the first ${formatDocCount(RESULT_CAP)} backend candidates · truncated`
          : matchCount > RESULT_CAP
            ? `Showing first ${formatDocCount(RESULT_CAP)} of ${formatDocCount(matchCount)} matches`
            : `${formatDocCount(results.length)} results`} · times shown in local timezone</span>
        <div className="seg">
          <ToolButton title="Copy all results to the clipboard as NDJSON" disabled={!results.length} onClick={() => void copyNdjson()}>
            <Icon name="copy" /> NDJSON
          </ToolButton>
          <Pagination page={page} totalPages={totalPages} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
        </div>
      </div>
    </section>
  );
}
