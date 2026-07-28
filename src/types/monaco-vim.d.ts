declare module "monaco-vim" {
  import type { editor } from "monaco-editor";

  export interface VimModeChangeEvent {
    mode: string;
    subMode?: string;
  }

  export interface VimAdapter {
    dispose(): void;
    on(event: "vim-mode-change", handler: (event: VimModeChangeEvent) => void): void;
    off(event: "vim-mode-change", handler: (event: VimModeChangeEvent) => void): void;
  }

  export function initVimMode(
    codeEditor: editor.IStandaloneCodeEditor,
    statusBar?: HTMLElement | null,
  ): VimAdapter;
}
