import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Icon, type IconName } from "./Icon";

export interface ContextMenuItem {
  icon: IconName;
  label: string;
  strong?: boolean;
  /** shortcut hint rendered right-aligned (e.g. "⌘D") */
  kbd?: string;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // clamp to viewport
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 12}px`;
    if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 12}px`;
    requestAnimationFrame(() => el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus());
  }, [x, y]);

  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    if (!buttons.length) return;
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <motion.div
      ref={ref}
      className="index-context-menu"
      role="menu"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.93, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.93 }}
      transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
    >
      {items.map((item, index) => (
        <button
          type="button"
          role="menuitem"
          key={item.label}
          className="context-item"
          onKeyDown={(event) => moveFocus(event, index)}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          <Icon name={item.icon} size={15} />
          {item.strong ? <strong>{item.label}</strong> : <span>{item.label}</span>}
          {item.kbd ? <span className="kbd">{item.kbd}</span> : <span />}
        </button>
      ))}
    </motion.div>
  );
}
