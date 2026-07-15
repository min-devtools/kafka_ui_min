import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Kv } from "../ui/Kv";
import { MiniTabs } from "../ui/MiniTabs";
import { ToolButton } from "../ui/ToolButton";
import { Icon } from "../ui/Icon";
import { JsonView } from "../ui/JsonView";
import { useApp } from "../store";

function prettyPayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

export function Inspector() {
  const [pane, setPane] = useState("payload");
  const { selectedMsg, showToast } = useApp();

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <div className="doc-title">
          <strong>{selectedMsg ? `offset ${selectedMsg.offset}` : "no message"}</strong>
          <span>
            {selectedMsg
              ? `${selectedMsg.topic} · partition ${selectedMsg.partition}`
              : "select a row to inspect"}
          </span>
        </div>
      </div>
      <MiniTabs
        tabs={[
          { id: "payload", label: "Payload" },
          { id: "meta", label: "Metadata" },
        ]}
        active={pane}
        onChange={setPane}
      />
      {pane === "payload" && (
        <div className="inspector-scroll">
          {!selectedMsg && <div className="empty-note">Load messages and click a row — the payload shows here.</div>}
          {selectedMsg && (
            <>
              <JsonView className="create-preview json-tree" value={prettyPayload(selectedMsg.payload)} />
              {selectedMsg.truncated && (
                <div className="empty-note">Payload truncated at 32 KB for display.</div>
              )}
              <div className="seg" style={{ padding: "8px 12px" }}>
                <ToolButton
                  onClick={async () => {
                    await writeText(selectedMsg.payload);
                    showToast("Copied", "Message payload copied to clipboard.");
                  }}
                >
                  <Icon name="copy" /> Copy payload
                </ToolButton>
              </div>
            </>
          )}
        </div>
      )}
      {pane === "meta" && (
        <div className="inspector-scroll">
          {!selectedMsg && <div className="empty-note">No message selected.</div>}
          {selectedMsg && (
            <div className="panel">
              <h3>Metadata</h3>
              <Kv label="topic">{selectedMsg.topic}</Kv>
              <Kv label="partition">{selectedMsg.partition}</Kv>
              <Kv label="offset">{selectedMsg.offset}</Kv>
              <Kv label="timestamp">
                {selectedMsg.timestamp ? new Date(selectedMsg.timestamp).toISOString() : "—"}
              </Kv>
              <Kv label="key">{selectedMsg.key ?? "—"}</Kv>
              {selectedMsg.headers.map(([k, v]) => (
                <Kv key={k} label={`header · ${k}`}>{v}</Kv>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
