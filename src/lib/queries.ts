import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Connection } from "./types";
import { fetchGroupMembers, fetchGroupOffsets, fetchGroups, fetchMetadata, fetchTopicConfig, fetchTopicOffsets, fetchTopicStats } from "./kafka";
import { activeConnection, useApp } from "../store";

/** One cluster sync every 10s is plenty — applies to all background polling. */
const SYNC_INTERVAL = 10_000;

export function useActiveConnection(): Connection | null {
  return useApp((s) => activeConnection(s));
}

export function useClusterMeta() {
  const conn = useActiveConnection();
  return useQuery({
    queryKey: ["cluster-meta", conn?.id],
    queryFn: () => fetchMetadata(conn!),
    enabled: !!conn,
    refetchInterval: SYNC_INTERVAL,
    staleTime: SYNC_INTERVAL,
  });
}

export function useTopicStats() {
  const conn = useActiveConnection();
  return useQuery({
    queryKey: ["topic-stats", conn?.id],
    queryFn: () => fetchTopicStats(conn!),
    enabled: !!conn,
    // watermark probe hits every partition — poll slower than metadata
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
}

export function useGroups() {
  const conn = useActiveConnection();
  return useQuery({
    queryKey: ["groups", conn?.id],
    queryFn: () => fetchGroups(conn!),
    enabled: !!conn,
    refetchInterval: SYNC_INTERVAL,
    staleTime: SYNC_INTERVAL,
  });
}

export function useGroupOffsets(group: string | null) {
  const conn = useActiveConnection();
  return useQuery({
    queryKey: ["group-offsets", conn?.id, group],
    queryFn: () => fetchGroupOffsets(conn!, group!),
    enabled: !!conn && !!group,
    refetchInterval: SYNC_INTERVAL,
    staleTime: SYNC_INTERVAL,
  });
}

export function useGroupMembers(group: string | null) {
  const conn = useActiveConnection();
  return useQuery({
    queryKey: ["group-members", conn?.id, group],
    queryFn: () => fetchGroupMembers(conn!, group!),
    enabled: !!conn && !!group,
    refetchInterval: SYNC_INTERVAL,
    staleTime: SYNC_INTERVAL,
  });
}

export function useTopicOffsets(topic: string | null) {
  const conn = useActiveConnection();
  return useQuery({
    queryKey: ["topic-offsets", conn?.id, topic],
    queryFn: () => fetchTopicOffsets(conn!, topic!),
    enabled: !!conn && !!topic,
    refetchInterval: SYNC_INTERVAL,
    staleTime: SYNC_INTERVAL,
  });
}

export function useTopicConfig(topic: string | null) {
  const conn = useActiveConnection();
  return useQuery({
    queryKey: ["topic-config", conn?.id, topic],
    queryFn: () => fetchTopicConfig(conn!, topic!),
    enabled: !!conn && !!topic,
    refetchInterval: SYNC_INTERVAL,
    staleTime: SYNC_INTERVAL,
  });
}

export function useSystemFonts() {
  return useQuery({
    queryKey: ["system-fonts"],
    queryFn: () => invoke<string[]>("list_fonts"),
    staleTime: Infinity,
  });
}
