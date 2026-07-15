declare module "monaco-vim" {
  import type { editor } from "monaco-editor";
  export function initVimMode(
    codeEditor: editor.IStandaloneCodeEditor,
    statusBar?: HTMLElement | null,
  ): { dispose(): void };
}
