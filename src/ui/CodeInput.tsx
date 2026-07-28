import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { initVimMode, type VimAdapter, type VimModeChangeEvent } from "monaco-vim";
import { MONACO_THEME } from "../lib/monaco";
import { useApp } from "../store";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** element the vim statusbar renders into (mode indicator) */
  vimStatusRef?: React.RefObject<HTMLElement>;
  onVimModeChange?: (mode: string) => void;
  height?: number | string;
  language?: string;
}

/** Compact Monaco editor for filter expressions / payloads — theme/font/vim follow app settings. */
export function CodeInput({ value, onChange, vimStatusRef, onVimModeChange, height = 64, language = "javascript" }: Props) {
  const vimMode = useApp((s) => s.vimMode);
  const editorFont = useApp((s) => s.editorFont);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const vimRef = useRef<VimAdapter | null>(null);
  const vimModeHandlerRef = useRef<((event: VimModeChangeEvent) => void) | null>(null);
  const modeChangeRef = useRef(onVimModeChange);
  modeChangeRef.current = onVimModeChange;

  const disposeVim = () => {
    if (vimRef.current && vimModeHandlerRef.current) {
      vimRef.current.off("vim-mode-change", vimModeHandlerRef.current);
    }
    vimRef.current?.dispose();
    vimRef.current = null;
    vimModeHandlerRef.current = null;
  };

  const startVim = (editor: Parameters<OnMount>[0]) => {
    if (vimRef.current) return;
    const adapter = initVimMode(editor, vimStatusRef?.current ?? null);
    const onMode = (event: VimModeChangeEvent) => modeChangeRef.current?.(event.mode);
    adapter.on("vim-mode-change", onMode);
    vimRef.current = adapter;
    vimModeHandlerRef.current = onMode;
    modeChangeRef.current?.("normal");
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (vimMode && editor && !vimRef.current) {
      startVim(editor);
    }
    if (!vimMode && vimRef.current) {
      disposeVim();
      if (vimStatusRef?.current) vimStatusRef.current.textContent = "";
      modeChangeRef.current?.("normal");
    }
    return disposeVim;
  }, [vimMode, vimStatusRef]);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (useApp.getState().vimMode && !vimRef.current) {
      startVim(editor);
    }
  };

  return (
    <div style={{ height, border: "1px solid var(--line-2)", borderRadius: 9, overflow: "hidden" }}>
      <Editor
        language={language}
        theme={MONACO_THEME}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={onMount}
        options={{
          minimap: { enabled: false },
          fontSize: 12.5,
          lineHeight: 20,
          fontFamily: editorFont
            ? `"${editorFont}", ui-monospace, Menlo, monospace`
            : '"Google Sans Code", "Berkeley Mono", ui-monospace, Menlo, Consolas, monospace',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          lineNumbers: "off",
          glyphMargin: false,
          folding: false,
          stickyScroll: { enabled: false },
          lineDecorationsWidth: 6,
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
          padding: { top: 6 },
          wordWrap: "on",
        }}
      />
    </div>
  );
}
