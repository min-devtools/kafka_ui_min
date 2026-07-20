import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Kv } from "../ui/Kv";
import { MiniTabs } from "../ui/MiniTabs";
import { ToolButton } from "../ui/ToolButton";
import { Icon } from "../ui/Icon";
import { JsonEditor } from "../ui/JsonEditor";
import { formatTs } from "../lib/format";
import { useApp } from "../store";

function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function Inspector() {
  const [pane, setPane] = useState("payload");
  const selectedMsg = useApp((s) => s.selectedMsg);
  const showToast = useApp((s) => s.showToast);

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
        !selectedMsg ? (
          <div className="inspector-scroll">
            <div className="empty-note">Load messages and click a row — the payload shows here.</div>
          </div>
        ) : (
          <div className="inspector-edit">
            <div className="inspector-editor-host">
              <JsonEditor value={prettyPayload(selectedMsg.payload)} readOnly lineNumbers />
            </div>
            <div className="inspector-edit-foot">
              <span className="seg">
                <span style={{ color: "var(--text-3)" }}>
                  {selectedMsg.truncated ? "Payload truncated at 32 KB" : "Read-only"}
                </span>
              </span>
              <ToolButton
                onClick={async () => {
                  await writeText(selectedMsg.payload);
                  showToast("Copied", "Message payload copied to clipboard.");
                }}
              >
                <Icon name="copy" /> Copy payload
              </ToolButton>
            </div>
          </div>
        )
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
                {selectedMsg.timestamp
                  ? `${formatTs(selectedMsg.timestamp)} (local) · ${new Date(selectedMsg.timestamp).toISOString()}`
                  : "—"}
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
