import { load, type Store } from "@tauri-apps/plugin-store";
import type { Connection } from "./types";
import { useApp } from "../store";

let store: Store | null = null;

export async function initPersistence(): Promise<void> {
  try {
    store = await load("kafkamin.json", { autoSave: true, defaults: {} });
    const connections = (await store.get<Connection[]>("connections")) ?? [];
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
      if (s.connections !== prev.connections) void store.set("connections", s.connections);
      if (s.activeConnId !== prev.activeConnId) void store.set("activeConnId", s.activeConnId);
    }
    // session restore: open tabs (not message results)
    if (
      s.tabs !== prev.tabs ||
      s.activeTabId !== prev.activeTabId ||
      s.msgTabs !== prev.msgTabs ||
      s.activeTopic !== prev.activeTopic
    ) {
      localStorage.setItem(
        "kafkamin:session",
        JSON.stringify({
          tabs: s.tabs,
          activeTabId: s.activeTabId,
          activeTopic: s.activeTopic,
          msgTabCounter: s.msgTabCounter,
          msgTabs: s.msgTabs,
        }),
      );
    }
    prev = s;
  });
}
