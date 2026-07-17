import { load, type Store } from "@tauri-apps/plugin-store";
import type { Connection } from "./types";
import { secretDelete, secretGet, secretSet } from "./kafka";
import { useApp } from "../store";

let store: Store | null = null;

const stripSecret = ({ password: _password, ...rest }: Connection) => rest;

/** Passwords live in the OS keychain; kafkamin.json only holds the rest. */
async function syncSecrets(next: Connection[], prev: Connection[]): Promise<void> {
  for (const c of next) {
    const old = prev.find((p) => p.id === c.id);
    if (c.password && c.password !== old?.password) await secretSet(c.id, c.password);
    if (!c.password && old?.password) await secretDelete(c.id);
  }
  for (const old of prev) {
    if (old.password && !next.some((c) => c.id === old.id)) await secretDelete(old.id);
  }
}

export async function initPersistence(): Promise<void> {
  try {
    store = await load("kafkamin.json", { autoSave: true, defaults: {} });
    const stored = (await store.get<Connection[]>("connections")) ?? [];
    const connections: Connection[] = [];
    let migrated = false;
    for (const c of stored) {
      if (c.password) {
        // legacy plaintext password in kafkamin.json — move it into the keychain
        await secretSet(c.id, c.password).catch(console.error);
        migrated = true;
        connections.push(c);
      } else {
        const secret = await secretGet(c.id).catch(() => null);
        connections.push(secret ? { ...c, password: secret } : c);
      }
    }
    if (migrated) await store.set("connections", stored.map(stripSecret));
    const activeConnId = (await store.get<string | null>("activeConnId")) ?? null;
    useApp.setState({
      connections,
      activeConnId: connections.some((c) => c.id === activeConnId) ? activeConnId : null,
    });
  } catch (err) {
    console.error("failed to load persisted store", err);
  }

  let prev = useApp.getState();
  useApp.subscribe((s) => {
    if (store) {
      if (s.connections !== prev.connections) {
        void syncSecrets(s.connections, prev.connections).catch(console.error);
        void store.set("connections", s.connections.map(stripSecret));
      }
      if (s.activeConnId !== prev.activeConnId) void store.set("activeConnId", s.activeConnId);
    }
    // session restore: open tabs (not message results)
    if (
      s.tabs !== prev.tabs ||
      s.activeTabId !== prev.activeTabId ||
      s.msgTabs !== prev.msgTabs ||
      s.groupTabs !== prev.groupTabs ||
      s.activeTopic !== prev.activeTopic ||
      s.topicRecency !== prev.topicRecency
    ) {
      localStorage.setItem(
        "kafkamin:session",
        JSON.stringify({
          tabs: s.tabs,
          activeTabId: s.activeTabId,
          activeTopic: s.activeTopic,
          topicRecency: s.topicRecency,
          msgTabCounter: s.msgTabCounter,
          msgTabs: s.msgTabs,
          groupTabs: s.groupTabs,
        }),
      );
    }
    prev = s;
  });
}
