import { openUrl } from "@tauri-apps/plugin-opener";
import { useShallow } from "zustand/react/shallow";
import { Icon } from "../../ui/Icon";
import { ToolButton } from "../../ui/ToolButton";
import { useApp } from "../../store";
import { useSystemFonts } from "../../lib/queries";
import { THEMES, themeBase } from "../../lib/themes";
import { FONT_SIZE_STEP } from "../../lib/fontScale";

export function SettingsView({ active }: { active: boolean }) {
  const {
    theme, setTheme, compact, toggleCompact, vimMode, toggleVim,
    uiFontSize, setUiFontSize, uiFont, setUiFont, editorFont, setEditorFont, showToast,
  } = useApp(
    useShallow((s) => ({
      theme: s.theme, setTheme: s.setTheme, compact: s.compact, toggleCompact: s.toggleCompact,
      vimMode: s.vimMode, toggleVim: s.toggleVim, uiFontSize: s.uiFontSize, setUiFontSize: s.setUiFontSize,
      uiFont: s.uiFont, setUiFont: s.setUiFont, editorFont: s.editorFont, setEditorFont: s.setEditorFont,
      showToast: s.showToast,
    })),
  );
  const fonts = useSystemFonts();
  const fontList = fonts.data ?? [];

  return (
    <section className={`content settings-view ${active ? "active" : ""}`}>
      <div className="settings-shell">
        <div className="settings-header">
          <h2>Settings</h2>
          <p style={{ margin: 0, color: "var(--text-3)", fontSize: "0.9231rem" }}>Appearance, fonts and keyboard shortcuts for this workspace.</p>
        </div>

        <section className="settings-card">
          <h3>Appearance</h3>
          <div className="settings-row">
            <span className="settings-icon"><Icon name={themeBase(theme) === "dark" ? "moon" : "sun"} size={15} /></span>
            <div className="settings-copy"><strong>Theme</strong><span>Palette applies across the workspace and payload views.</span></div>
            <div className="settings-control">
              <select className="settings-select" value={theme} onChange={(event) => setTheme(event.target.value)}><optgroup label="Dark">{THEMES.filter((item) => item.base === "dark").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup><optgroup label="Light">{THEMES.filter((item) => item.base === "light").map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup></select>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="braces" size={15} /></span>
            <div className="settings-copy"><strong>Interface font size</strong><span>Scales all interface text in 0.5px steps. Current: {uiFontSize}px.</span></div>
            <div className="settings-control" style={{ gap: 6 }}>
              <ToolButton iconOnly title="Decrease interface font (⌘−)" onClick={() => setUiFontSize(uiFontSize - FONT_SIZE_STEP)}>−</ToolButton>
              <ToolButton onClick={() => setUiFontSize(0)}>{uiFontSize}px</ToolButton>
              <ToolButton iconOnly title="Increase interface font (⌘+)" onClick={() => setUiFontSize(uiFontSize + FONT_SIZE_STEP)}>+</ToolButton>
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="rows" size={15} /></span>
            <div className="settings-copy"><strong>Interface font family</strong><span>Applied across the workspace and saved on this device.</span></div>
            <div className="settings-control"><select className="settings-select" value={uiFont} style={uiFont ? { fontFamily: `"${uiFont}"` } : undefined} onChange={(event) => setUiFont(event.target.value)}><option value="">Design default</option>{fontList.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}"` }}>{font}</option>)}</select></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="braces" size={15} /></span>
            <div className="settings-copy"><strong>Editor font family</strong><span>Applied to message payloads and JSON views.</span></div>
            <div className="settings-control"><select className="settings-select" value={editorFont} style={editorFont ? { fontFamily: `"${editorFont}"` } : undefined} onChange={(event) => setEditorFont(event.target.value)}><option value="">Design default</option>{fontList.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}"` }}>{font}</option>)}</select></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="rows" size={15} /></span>
            <div className="settings-copy"><strong>Compact density</strong><span>Tighter table rows and narrower side panels.</span></div>
            <div className="settings-control"><label className="switch"><input type="checkbox" checked={compact} onChange={toggleCompact} /><span /></label></div>
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="keyboard" size={15} /></span>
            <div className="settings-copy"><strong>Vim mode</strong><span>Modal editing via monaco-vim in the JS filter editor.</span></div>
            <div className="settings-control"><label className="switch"><input type="checkbox" checked={vimMode} onChange={() => { toggleVim(); showToast("Vim mode", vimMode ? "Disabled." : "Enabled — NORMAL mode in JS filter editor."); }} /><span /></label></div>
          </div>
        </section>

        <section className="settings-card">
          <h3>Shortcuts</h3>
          <div className="shortcut-grid">
            <div className="shortcut-row"><span>Command palette</span><span className="kbd">⌘K</span></div>
            <div className="shortcut-row"><span>Open messages (active topic)</span><span className="kbd">⌘N</span></div>
            <div className="shortcut-row"><span>Load messages</span><span className="kbd">⌘↵</span></div>
            <div className="shortcut-row"><span>Browse topics</span><span className="kbd">⌘T</span></div>
            <div className="shortcut-row"><span>Consumer groups</span><span className="kbd">⌘G</span></div>
            <div className="shortcut-row"><span>Toggle sidebar</span><span className="kbd">⌘B</span></div>
            <div className="shortcut-row"><span>Toggle inspector</span><span className="kbd">⌘R</span></div>
            <div className="shortcut-row"><span>Close tab</span><span className="kbd">⌘W</span></div>
            <div className="shortcut-row"><span>Switch tab 1…9</span><span className="kbd">⌘1…9</span></div>
            <div className="shortcut-row"><span>Increase font</span><span className="kbd">⌘+</span></div>
            <div className="shortcut-row"><span>Decrease font</span><span className="kbd">⌘−</span></div>
            <div className="shortcut-row"><span>Open settings</span><span className="kbd">⌘,</span></div>
            <div className="shortcut-row"><span>Rename / edit selected connection</span><span className="kbd">⌘E</span></div>
            <div className="shortcut-row"><span>Duplicate selected connection</span><span className="kbd">⌘D</span></div>
            <div className="shortcut-row"><span>Delete selected connection</span><span className="kbd">⌘⌫</span></div>
          </div>
        </section>

        <section className="settings-card">
          <h3>Data</h3>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="database" size={15} /></span>
            <div className="settings-copy"><strong>Connections</strong><span>Stored in Tauri app-data (kafkamin.json). Right-click a connection in the sidebar to edit or remove it.</span></div>
            <div className="settings-control" />
          </div>
          <div className="settings-row">
            <span className="settings-icon"><Icon name="check" size={15} /></span>
            <div className="settings-copy"><strong>Read-only by default</strong><span>Message viewing never commits offsets. Only "Reset offsets" in Consumer Groups writes to the cluster, and it always asks first.</span></div>
            <div className="settings-control" />
          </div>
        </section>

        <div className="settings-credit">
          <button
            type="button"
            className="settings-github"
            onClick={() => openUrl("https://github.com/min-devtools/kafka_ui_min")}
          >
            <Icon name="github" size={15} /> View on GitHub
          </button>
          <strong>KafkaMin</strong>
          <button
            type="button"
            className="settings-credit-link"
            onClick={() => openUrl("https://www.linkedin.com/in/ngthminh-dev/")}
          >
            Created by @ngthminhdev
          </button>
        </div>
      </div>
    </section>
  );
}
