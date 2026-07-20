import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { initVimMode } from "monaco-vim";
import { MONACO_THEME } from "../lib/monaco";
import { useApp } from "../store";

interface Props {
  value: string;
  onChange?: (v: string) => void;
  /** element the vim statusbar renders into (mode indicator) */
  vimStatusRef?: React.RefObject<HTMLElement>;
  fontSize?: number;
  lineNumbers?: boolean;
  /** read-only viewer (e.g. query results) — no editing, no vim */
  readOnly?: boolean;
}

/** Monaco JSON editor — theme/font/vim follow app settings. */
export function JsonEditor({ value, onChange, vimStatusRef, fontSize, lineNumbers = true, readOnly = false }: Props) {
  const vimMode = useApp((s) => s.vimMode);
  const editorFont = useApp((s) => s.editorFont);
  const editorFontSize = useApp((s) => s.editorFontSize);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const vimRef = useRef<{ dispose(): void } | null>(null);

  const size = fontSize ?? editorFontSize;

  useEffect(() => {
    if (readOnly) return;
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
  }, [vimMode, vimStatusRef, readOnly]);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (!readOnly && useApp.getState().vimMode && !vimRef.current) {
      vimRef.current = initVimMode(editor, vimStatusRef?.current ?? null);
    }
  };

  return (
    <Editor
      language="json"
      theme={MONACO_THEME}
      value={value}
      onChange={(v) => onChange?.(v ?? "")}
      onMount={onMount}
      options={{
        readOnly,
        domReadOnly: readOnly,
        minimap: { enabled: false },
        fontSize: size,
        lineHeight: Math.round(size * 1.65),
        fontFamily: editorFont
          ? `"${editorFont}", ui-monospace, Menlo, monospace`
          : '"Google Sans Code", "Berkeley Mono", ui-monospace, Menlo, Consolas, monospace',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        lineNumbers: lineNumbers ? "on" : "off",
        glyphMargin: false,
        folding: true,
        stickyScroll: { enabled: false },
        lineDecorationsWidth: 6,
        renderLineHighlight: "none",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        padding: { top: 8 },
        wordWrap: "on",
      }}
    />
  );
}
