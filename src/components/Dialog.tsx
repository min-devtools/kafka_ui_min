import { useEffect, useRef, useState } from "react";
import { ToolButton } from "../ui/ToolButton";
import { useApp } from "../store";

/** In-app replacement for window.prompt/confirm — those don't render in the Tauri webview. */
export function Dialog() {
  const dialog = useApp((s) => s.dialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dialog?.kind === "prompt") {
      setValue(dialog.defaultValue ?? "");
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [dialog]);

  if (!dialog) return null;

  const cancel = () => dialog.resolve(null);
  const submit = () => {
    if (dialog.kind === "prompt" && !value.trim()) return;
    dialog.resolve(dialog.kind === "prompt" ? value : "1");
  };

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className="prompt-dialog">
        <strong>{dialog.title}</strong>
        {dialog.message && <p className="prompt-dialog-msg">{dialog.message}</p>}
        {dialog.kind === "prompt" && (
          <input
            ref={inputRef}
            className="side-search"
            style={{ width: "100%" }}
            value={value}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") cancel();
            }}
          />
        )}
        <div className="prompt-dialog-foot">
          <ToolButton onClick={cancel}>Cancel</ToolButton>
          <ToolButton
            variant={dialog.danger ? "danger" : "primary"}
            disabled={dialog.kind === "prompt" && !value.trim()}
            onClick={submit}
          >
            {dialog.confirmLabel ?? (dialog.kind === "prompt" ? "Save" : "Confirm")}
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
