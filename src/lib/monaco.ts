// Bundle Monaco locally (no CDN) and register only the workers we need.
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { loader } from "@monaco-editor/react";

export const MONACO_THEME = "kafkamin-live";

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "typescript" || label === "javascript") return new tsWorker();
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};

// bare (no "#") hex for Monaco token colors; "#rrggbb" for editor.colors
const bare = (v: string | undefined, fallback: string) =>
  (v?.trim().startsWith("#") ? v.trim() : `#${fallback}`).slice(1);
const withHash = (v: string | undefined, fallback: string) =>
  v?.trim().startsWith("#") ? v.trim() : `#${fallback}`;

function defineThemes(base: "dark" | "light", p: Record<string, string>) {
  monaco.editor.defineTheme(MONACO_THEME, {
    base: base === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "string", foreground: bare(p.syntaxString, "58d68d") },
      { token: "number", foreground: bare(p.syntaxNumber, "79c0ff") },
      { token: "keyword", foreground: bare(p.syntaxBoolean, "b794f4") },
      { token: "identifier", foreground: bare(p.textPrimary, "d7dce5") },
      { token: "delimiter", foreground: bare(p.textMuted, "717680") },
    ],
    colors: {
      "editor.background": withHash(p.surfaceEditor, base === "dark" ? "0d0f14" : "fbfbfc"),
      "editor.foreground": withHash(p.textPrimary, base === "dark" ? "d7dce5" : "1c2430"),
      "editorLineNumber.foreground": withHash(p.textMuted, "4a4f58"),
      "editorCursor.foreground": withHash(p.accentFocus, "5aa7ff"),
      "editor.selectionBackground": withHash(p.accentPrimary, "5aa7ff") + "44",
      "editor.inactiveSelectionBackground": withHash(p.accentPrimary, "5aa7ff") + "22",
      "editorWidget.background": withHash(p.surfaceRaised, "191b21"),
      "editorWidget.border": withHash(p.borderDefault, "333842"),
      "editorSuggestWidget.selectedBackground": withHash(p.accentPrimary, "5aa7ff") + "33",
      "editorError.foreground": withHash(p.statusDanger, "ff6b75"),
      "editorWarning.foreground": withHash(p.statusWarning, "f7b267"),
    },
  });
}

defineThemes("dark", {});

/** Re-tint Monaco to the active app theme's actual palette (not just dark/light). */
export function retintMonaco(base: "dark" | "light", palette: Record<string, string>) {
  defineThemes(base, palette);
  monaco.editor.setTheme(MONACO_THEME);
}

// --- message-field autocomplete (fed by the active Messages tab's loaded payloads) ---
let messageFields: string[] = [];
export function setMessageFields(fields: string[]) {
  messageFields = fields;
}

const FILTER_ARGS: { name: string; detail: string }[] = [
  { name: "value", detail: "parsed JSON payload" },
  { name: "key", detail: "message key (string | null)" },
  { name: "partition", detail: "partition number" },
  { name: "offset", detail: "message offset" },
  { name: "timestamp", detail: "epoch ms | null" },
  { name: "headers", detail: "headers object" },
];

monaco.languages.registerCompletionItemProvider("javascript", {
  triggerCharacters: ["."],
  provideCompletionItems(model, position) {
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber, word.startColumn, position.lineNumber, word.endColumn,
    );
    const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    // typing a path under `value.` → suggest the next segment from sampled messages
    const m = line.match(/\bvalue((?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)?$/);
    if (m) {
      const prefix = m[1] ? `${m[1].slice(1)}.` : "";
      const children = new Set<string>();
      for (const f of messageFields) {
        if (f.startsWith(prefix)) {
          const seg = f.slice(prefix.length).split(".")[0];
          if (seg) children.add(seg);
        }
      }
      return {
        suggestions: [...children].sort().map((c) => ({
          label: c,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: c,
          detail: "message field",
          range,
        })),
      };
    }
    // bare identifier → offer the filter arguments
    if (line.endsWith(".")) return { suggestions: [] };
    return {
      suggestions: FILTER_ARGS.map((a) => ({
        label: a.name,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: a.name,
        detail: a.detail,
        range,
      })),
    };
  },
});

loader.config({ monaco });

export { monaco };
