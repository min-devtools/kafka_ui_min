import { invoke } from "@tauri-apps/api/core";
import type {
  ClusterHealth,
  ClusterMeta,
  ConfigEntry,
  Connection,
  GroupInfo,
  GroupMember,
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

export const fetchClusterHealth = (conn: Connection) =>
  invoke<ClusterHealth>("kafka_cluster_health", { conn: wire(conn) });

export const fetchBrokerConfig = (conn: Connection, broker: number) =>
  invoke<ConfigEntry[]>("kafka_broker_config", { conn: wire(conn), broker });

export const fetchTopicOffsets = (conn: Connection, topic: string) =>
  invoke<PartitionOffsets[]>("kafka_topic_offsets", { conn: wire(conn), topic });

export const fetchTopicStats = (conn: Connection) =>
  invoke<TopicStats[]>("kafka_topic_stats", { conn: wire(conn) });

export const fetchTopicConfig = (conn: Connection, topic: string) =>
  invoke<ConfigEntry[]>("kafka_topic_config", { conn: wire(conn), topic });

/** Set and/or clear topic config overrides. Clearing returns the setting to the broker default. */
export const alterTopicConfig = (
  conn: Connection,
  topic: string,
  set: Record<string, string>,
  remove: string[],
) => invoke<void>("kafka_alter_topic_config", { conn: wire(conn), topic, set, remove });

/** Grow a topic to `total` partitions — Kafka can only add, never remove. */
export const addPartitions = (conn: Connection, topic: string, total: number) =>
  invoke<void>("kafka_add_partitions", { conn: wire(conn), topic, total });

/** Delete every retained message in all partitions (truncate to high watermark). */
export const purgeTopic = (conn: Connection, topic: string) =>
  invoke<void>("kafka_purge_topic", { conn: wire(conn), topic });

export const fetchGroups = (conn: Connection) =>
  invoke<GroupInfo[]>("kafka_groups", { conn: wire(conn) });

export const fetchGroupOffsets = (conn: Connection, group: string) =>
  invoke<GroupOffset[]>("kafka_group_offsets", { conn: wire(conn), group });

export const fetchGroupMembers = (conn: Connection, group: string) =>
  invoke<GroupMember[]>("kafka_group_members", { conn: wire(conn), group });

export type ConsumeFrom = "end" | "start" | "offset" | "timestamp";

export interface ConsumeResult {
  messages: MessageRec[];
  /** true when the backend deadline hit before every partition was drained */
  partial: boolean;
}

export const consumeMessages = (
  conn: Connection,
  topic: string,
  opts: { limit: number; partition: number | null; from: ConsumeFrom; offset?: number | null; timestampMs?: number | null },
) =>
  invoke<ConsumeResult>("kafka_consume", {
    conn: wire(conn),
    topic,
    limit: opts.limit,
    partition: opts.partition,
    from: opts.from,
    offset: opts.offset ?? null,
    timestampMs: opts.timestampMs ?? null,
  });

export const startLiveMessages = (
  conn: Connection,
  liveId: string,
  topic: string,
  partition: number | null,
) => invoke<void>("kafka_live_start", { conn: wire(conn), liveId, topic, partition });

export const stopLiveMessages = (liveId: string) =>
  invoke<void>("kafka_live_stop", { liveId });

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

/** Connection passwords live in the OS keychain, keyed by connection id. */
export const secretSet = (id: string, secret: string) => invoke<void>("secret_set", { id, secret });
export const secretGet = (id: string) => invoke<string | null>("secret_get", { id });
export const secretDelete = (id: string) => invoke<void>("secret_delete", { id });

export const resetOffsets = (
  conn: Connection,
  group: string,
  topic: string,
  to: "earliest" | "latest" | "offset" | "timestamp",
  opts?: { partition?: number | null; offset?: number | null; timestampMs?: number | null },
) =>
  invoke<GroupOffset[]>("kafka_reset_offsets", {
    conn: wire(conn),
    group,
    topic,
    to,
    partition: opts?.partition ?? null,
    offset: opts?.offset ?? null,
    timestampMs: opts?.timestampMs ?? null,
  });
