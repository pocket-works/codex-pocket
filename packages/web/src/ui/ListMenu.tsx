import { useEffect, useRef, useState } from "react";
import type { RateLimits, RateLimitWindow, Session } from "../state/session.js";
import type { ListView } from "../state/list-prefs.js";
import { useStore } from "../state/store.js";
import { ArchiveIcon, CheckIcon, ClockIcon, FolderIcon, MenuIcon, RefreshIcon, SettingsIcon } from "./icons.js";
import { navigate } from "./route.js";

// Thread-list menu modelled on the official app: view mode, Manage
// section, and remaining usage at the bottom.
export function ListMenu({ session, view, onView }: { session: Session; view: ListView; onView: (v: ListView) => void }) {
  const rateLimits = useStore(session.store, (s) => s.rateLimits);
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [show]);

  function pick(fn: () => void) {
    return () => {
      fn();
      setShow(false);
    };
  }

  return (
    <div className="tool-anchor" ref={ref}>
      <button className="icon-btn round" aria-label="Menu" aria-expanded={show} onClick={() => setShow((v) => !v)}>
        <MenuIcon />
      </button>
      {show && (
        <div className="popover-card menu right" role="menu">
          <MenuItem icon={<FolderIcon />} label="By project" checked={view === "project"} onClick={pick(() => onView("project"))} />
          <MenuItem icon={<ClockIcon />} label="Chronological list" checked={view === "chronological"} onClick={pick(() => onView("chronological"))} />
          <div className="menu-sep" />
          <div className="menu-heading">Manage</div>
          <MenuItem icon={<ArchiveIcon />} label="Archived threads" onClick={pick(() => navigate({ name: "archived" }))} />
          <MenuItem icon={<SettingsIcon />} label="Settings" onClick={pick(() => navigate({ name: "settings" }))} />
          <MenuItem icon={<RefreshIcon />} label="Refresh" onClick={pick(() => void session.loadThreads())} />
          {rateLimits && <UsageFooter limits={rateLimits} />}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, checked, onClick }: { icon: React.ReactNode; label: string; checked?: boolean; onClick: () => void }) {
  return (
    <button className="menu-item" role={checked === undefined ? "menuitem" : "menuitemradio"} aria-checked={checked} onClick={onClick}>
      <span className="menu-check">{checked && <CheckIcon />}</span>
      <span className="menu-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function windowLabel(w: RateLimitWindow): string {
  if (w.durationMins === null) return "";
  return w.durationMins >= 1440 ? `${Math.round(w.durationMins / 1440)}d` : `${Math.round(w.durationMins / 60)}h`;
}

function resetLabel(w: RateLimitWindow): string {
  if (!w.resetsAt) return "";
  const mins = Math.max(0, Math.round((w.resetsAt - Date.now()) / 60000));
  if (mins < 60) return `resets in ${mins}m`;
  const h = Math.round(mins / 60);
  return h < 48 ? `resets in ${h}h` : `resets in ${Math.round(h / 24)}d`;
}

function UsageFooter({ limits }: { limits: RateLimits }) {
  const windows = [limits.primary, limits.secondary].filter((w): w is RateLimitWindow => w !== null);
  if (windows.length === 0) return null;
  return (
    <>
      <div className="menu-sep" />
      <div className="menu-heading">Usage remaining</div>
      {windows.map((w, i) => (
        <div key={i} className="menu-usage">
          <span className={`usage-left ${w.usedPercent >= 90 ? "high" : ""}`}>{Math.max(0, 100 - Math.round(w.usedPercent))}% left</span>
          <span className="muted small">
            {windowLabel(w)} {resetLabel(w)}
          </span>
        </div>
      ))}
    </>
  );
}
