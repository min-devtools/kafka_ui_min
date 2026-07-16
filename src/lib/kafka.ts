import { invoke } from "@tauri-apps/api/core";
import type {
  ClusterMeta,
  Connection,
  GroupInfo,
  GroupOffset,
  MessageRec,
  PartitionOffsets,
  TopicStats,
  SearchCondition,
} from "./types";

const wire = (conn: Connection) => ({
  brokers: conn.brokers,
  securityProtocol: conn.securityProtocol,
  saslMechanism: conn.saslMechanism ?? null,
  username: conn.username ?? null,
  password: conn.password ?? null,
});

export const fetchMetadata = (conn: Connection) =>
  invoke<ClusterMeta>("kafka_metadata", { conn: wire(conn) });

export const fetchTopicOffsets = (conn: Connection, topic: string) =>
  invoke<PartitionOffsets[]>("kafka_topic_offsets", { conn: wire(conn), topic });

export const fetchTopicStats = (conn: Connection) =>
  invoke<TopicStats[]>("kafka_topic_stats", { conn: wire(conn) });

export const fetchGroups = (conn: Connection) =>
  invoke<GroupInfo[]>("kafka_groups", { conn: wire(conn) });

export const fetchGroupOffsets = (conn: Connection, group: string) =>
  invoke<GroupOffset[]>("kafka_group_offsets", { conn: wire(conn), group });

export type ConsumeFrom = "end" | "start" | "offset" | "timestamp";

export const consumeMessages = (
  conn: Connection,
  topic: string,
  opts: { limit: number; partition: number | null; from: ConsumeFrom; offset?: number | null; timestampMs?: number | null },
) =>
  invoke<MessageRec[]>("kafka_consume", {
    conn: wire(conn),
    topic,
    limit: opts.limit,
    partition: opts.partition,
    from: opts.from,
    offset: opts.offset ?? null,
    timestampMs: opts.timestampMs ?? null,
  });

export const startFullTopicSearch = (
  conn: Connection,
  searchId: string,
  topic: string,
  text: string,
  conditions: SearchCondition[],
) => invoke<void>("kafka_search_start", { conn: wire(conn), searchId, topic, text, conditions });

export const cancelFullTopicSearch = (searchId: string) =>
  invoke<void>("kafka_search_cancel", { searchId });

/** Idle/resume a running scan. Paused scans keep their offsets — resuming does not re-scan. */
export const setFullTopicSearchPaused = (searchId: string, paused: boolean) =>
  invoke<void>("kafka_search_set_paused", { searchId, paused });

export const produceMessage = (
  conn: Connection,
  topic: string,
  opts: { key: string | null; payload: string; partition: number | null; headers: [string, string][] },
) =>
  invoke<{ partition: number; offset: number }>("kafka_produce", {
    conn: wire(conn),
    topic,
    key: opts.key,
    payload: opts.payload,
    partition: opts.partition,
    headers: opts.headers,
  });

export const createTopic = (conn: Connection, topic: string, partitions: number, replication: number) =>
  invoke<void>("kafka_create_topic", { conn: wire(conn), topic, partitions, replication });

export const deleteTopic = (conn: Connection, topic: string) =>
  invoke<void>("kafka_delete_topic", { conn: wire(conn), topic });

export const deleteGroup = (conn: Connection, group: string) =>
  invoke<void>("kafka_delete_group", { conn: wire(conn), group });

export const resetOffsets = (
  conn: Connection,
  group: string,
  topic: string,
  to: "earliest" | "latest" | "offset",
  opts?: { partition?: number | null; offset?: number | null },
) =>
  invoke<GroupOffset[]>("kafka_reset_offsets", {
    conn: wire(conn),
    group,
    topic,
    to,
    partition: opts?.partition ?? null,
    offset: opts?.offset ?? null,
  });
