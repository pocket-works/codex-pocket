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
  if (w.durationMins >= 7 * 1440) return "Weekly";
  return w.durationMins >= 1440 ? `${Math.round(w.durationMins / 1440)}d limit` : `${Math.round(w.durationMins / 60)}h limit`;
}

function resetLabel(w: RateLimitWindow): string {
  if (!w.resetsAt) return "";
  const mins = Math.max(0, Math.round((w.resetsAt - Date.now()) / 60000));
  if (mins < 60) return `resets in ${mins}m`;
  const h = Math.round(mins / 60);
  return h < 48 ? `resets in ${h}h` : `resets in ${Math.round(h / 24)}d`;
}

// The official app's "Usage remaining" block: one bar per window with how
// much is left and when it resets, plus the credit balance when there is one.
function UsageFooter({ limits }: { limits: RateLimits }) {
  const windows = [limits.primary, limits.secondary].filter((w): w is RateLimitWindow => w !== null);
  if (windows.length === 0 && !limits.credits) return null;
  return (
    <>
      <div className="menu-sep" />
      <div className="menu-heading">Usage remaining</div>
      {windows.map((w, i) => {
        const left = Math.max(0, 100 - Math.round(w.usedPercent));
        return (
          <div key={i} className="menu-usage">
            <div className="usage-row">
              <span className={`usage-left ${left <= 10 ? "high" : ""}`}>{left}%</span>
              <span className="muted small">{windowLabel(w)}</span>
              <span className="spacer" />
              <span className="muted small">{resetLabel(w)}</span>
            </div>
            <div className="usage-bar" role="progressbar" aria-valuenow={left} aria-valuemin={0} aria-valuemax={100}>
              <div className={`usage-bar-fill ${left <= 10 ? "high" : ""}`} style={{ width: `${left}%` }} />
            </div>
          </div>
        );
      })}
      {limits.credits && (
        <div className="menu-usage">
          <div className="usage-row">
            <span className="muted small">Credits</span>
            <span className="spacer" />
            <span className="small">{limits.credits}</span>
          </div>
        </div>
      )}
    </>
  );
}
