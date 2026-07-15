import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { initVimMode } from "monaco-vim";
import { MONACO_THEME } from "../lib/monaco";
import { useApp } from "../store";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** element the vim statusbar renders into (mode indicator) */
  vimStatusRef?: React.RefObject<HTMLElement>;
  height?: number | string;
  language?: string;
}

/** Compact Monaco editor for filter expressions / payloads — theme/font/vim follow app settings. */
export function CodeInput({ value, onChange, vimStatusRef, height = 64, language = "javascript" }: Props) {
  const vimMode = useApp((s) => s.vimMode);
  const editorFont = useApp((s) => s.editorFont);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const vimRef = useRef<{ dispose(): void } | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (vimMode && editor && !vimRef.current) {
      vimRef.current = initVimMode(editor, vimStatusRef?.current ?? null);
    }
    if (!vimMode && vimRef.current) {
      vimRef.current.dispose();
      vimRef.current = null;
      if (vimStatusRef?.current) vimStatusRef.current.textContent = "";
    }
    return () => {
      vimRef.current?.dispose();
      vimRef.current = null;
    };
  }, [vimMode, vimStatusRef]);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (useApp.getState().vimMode && !vimRef.current) {
      vimRef.current = initVimMode(editor, vimStatusRef?.current ?? null);
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
