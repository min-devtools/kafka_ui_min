import type { IconName } from "../ui/Icon";
import type { ConnColor } from "./connColor";

export type SecurityProtocol = "plaintext" | "ssl" | "sasl_plaintext" | "sasl_ssl";
export type SaslMechanism = "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";

export interface Connection {
  id: string;
  name: string;
  /** user-assigned identity color, drawn as the dot on every tab bound to this connection */
  color?: ConnColor;
  /** comma-separated bootstrap servers, e.g. localhost:9092 */
  brokers: string;
  securityProtocol: SecurityProtocol;
  saslMechanism?: SaslMechanism;
  username?: string;
  password?: string;
}

export interface BrokerInfo {
  id: number;
  host: string;
  port: number;
}

export interface TopicInfo {
  name: string;
  partitions: number;
  replicas: number;
  internal: boolean;
}

export interface ClusterMeta {
  brokers: BrokerInfo[];
  topics: TopicInfo[];
}

export interface PartitionOffsets {
  partition: number;
  low: number;
  high: number;
}

export interface TopicStats {
  name: string;
  /** retained messages: sum of (high - low) */
  messages: number;
  /** sum of high watermarks */
  highTotal: number;
}

export interface TopicConfig {
  compression: string;
}

export interface GroupInfo {
  name: string;
  state: string;
  protocolType: string;
  members: number;
}

export interface GroupOffset {
  topic: string;
  partition: number;
  committed: number;
  low: number;
  high: number;
  lag: number;
}

export interface GroupAssignment {
  topic: string;
  partitions: number[];
}

export interface GroupMember {
  memberId: string;
  clientId: string;
  clientHost: string;
  assignments: GroupAssignment[];
}

export interface MessageRec {
  topic: string;
  partition: number;
  offset: number;
  timestamp: number | null;
  key: string | null;
  payload: string;
  truncated: boolean;
  headers: [string, string][];
}

export type SearchOperator = "equals" | "notEquals" | "contains" | "exists" | "gt" | "gte" | "lt" | "lte";

export interface SearchCondition {
  field: string;
  operator: SearchOperator;
  value: string;
}

export interface SearchBatch {
  searchId: string;
  messages: MessageRec[];
}

export interface SearchProgress {
  searchId: string;
  scanned: number;
  total: number;
  completedPartitions: number;
  totalPartitions: number;
  candidateMatches: number;
  elapsedMs: number;
  messagesPerSecond: number;
}

export interface SearchFinished {
  searchId: string;
  status: "completed" | "cancelled" | "failed";
  scanned: number;
  total: number;
  candidateMatches: number;
  error: string | null;
}

export type TabKind =
  | "welcome"
  | "connection"
  | "topics"
  | "groups"
  | "group"
  | "messages"
  | "cluster"
  | "produce"
  | "settings";

export interface TabDef {
  id: string;
  kind: TabKind;
  title: string;
  icon: IconName;
  iconClass: string;
  /**
   * Connection this tab is bound to, fixed at creation and never reassigned — a tab
   * represents one cluster for its whole life. Undefined on the global kinds
   * (welcome/connection/settings), which belong to the app rather than to a cluster.
   */
  connId?: string;
}

export interface MessagesTabState {
  topic: string;
}

export interface GroupTabState {
  group: string;
}
