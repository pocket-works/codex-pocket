import { useEffect, useRef, useState } from "react";
import { permissionPreset, Session, type PermissionPreset } from "../state/session.js";
import { useStore } from "../state/store.js";
import { ModelSheet } from "./ModelSheet.js";

// Small controls on the composer toolbar, mirroring the official app:
// a permissions popover, a context-window ring and an effort gauge.

const PRESETS: { value: PermissionPreset; title: string; hint: string; icon: string }[] = [
  { value: "ask", title: "Ask for approval", hint: "Always ask to edit external files and use the internet", icon: "✋" },
  { value: "auto", title: "Approve for me", hint: "Only ask for actions detected as potentially unsafe", icon: "🛡" },
  { value: "full", title: "Full access", hint: "Full computer access (elevated risk)", icon: "⚠️" },
];

export function PermissionsButton({ session, disabled }: { session: Session; disabled: boolean }) {
  const open = useStore(session.store, (s) => s.open);
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

  if (!open) return null;
  const active = permissionPreset(open.permissionOverride ?? open.permissions);

  return (
    <div className="tool-anchor" ref={ref}>
      <button className="icon-btn" aria-label="Approval policy" disabled={disabled} onClick={() => setShow((v) => !v)}>
        <GearIcon />
      </button>
      {show && (
        <div className="popover-card" role="menu">
          <div className="popover-title">How should Codex actions be approved?</div>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              className={`popover-option ${active === p.value ? "active" : ""}`}
              role="menuitemradio"
              aria-checked={active === p.value}
              onClick={() => {
                session.setPermissionPreset(p.value);
                setShow(false);
              }}
            >
              <span className="popover-icon">{p.icon}</span>
              <span>
                <span className="popover-option-title">{p.title}</span>
                <span className="popover-option-hint">{p.hint}</span>
              </span>
            </button>
          ))}
          {active === null && <p className="muted small">This thread uses a custom policy; pick one to replace it.</p>}
        </div>
      )}
    </div>
  );
}

export function ContextRing({ session }: { session: Session }) {
  const usage = useStore(session.store, (s) => s.open?.view.tokenUsage ?? null);
  const [show, setShow] = useState(false);
  if (!usage?.contextWindow) return null;
  const used = usage.contextTokens;
  const total = usage.contextWindow;
  const pct = Math.min(1, used / total);
  const left = Math.max(0, Math.round((1 - pct) * 100));
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <div className="tool-anchor">
      <button className="icon-btn ring-btn" aria-label={`Context window: ${left}% left`} onClick={() => setShow((v) => !v)} onBlur={() => setShow(false)}>
        <svg viewBox="0 0 24 24" width="22" height="22">
          <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
          <circle
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform="rotate(-90 12 12)"
            className={pct >= 0.8 ? "ring-high" : ""}
          />
        </svg>
      </button>
      {show && (
        <div className="popover-card tip">
          <div className="popover-title">Context window</div>
          <div>
            {left}% left ({fmtK(used)} used / {fmtK(total)})
          </div>
        </div>
      )}
    </div>
  );
}

// Lightning toggle for the model's faster service tier (Codex calls it
// "Fast"); hidden for models that only have the standard tier.
export function FastButton({ session, disabled }: { session: Session; disabled: boolean }) {
  const open = useStore(session.store, (s) => s.open);
  const models = useStore(session.store, (s) => s.models);
  if (!open) return null;
  const model = models.find((m) => m.model === Session.effectiveModel(open).model);
  const tier = model?.serviceTiers[0];
  if (!tier) return null;
  const fast = Session.isFast(open);
  const label = `${tier.name}: ${tier.description}`;
  return (
    <button
      className={`icon-btn fast-btn ${fast ? "active" : ""}`}
      aria-label={label}
      aria-pressed={fast}
      title={label}
      disabled={disabled}
      onClick={() => session.setServiceTier(fast ? null : tier.id)}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill={fast ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
      </svg>
    </button>
  );
}

export function EffortGauge({ session, disabled }: { session: Session; disabled: boolean }) {
  const open = useStore(session.store, (s) => s.open);
  const models = useStore(session.store, (s) => s.models);
  const [sheet, setSheet] = useState(false);
  if (!open) return null;
  const effective = Session.effectiveModel(open);
  const model = models.find((m) => m.model === effective.model);
  const efforts = model?.supportedReasoningEfforts.map((e) => e.reasoningEffort) ?? [];
  const idx = efforts.indexOf(effective.effort ?? "");
  // Needle from 0 (leftmost) to 1 (rightmost) across a 180° gauge.
  const level = efforts.length > 1 && idx >= 0 ? idx / (efforts.length - 1) : 0.5;
  const angle = -90 + level * 180;
  const label = `${model?.displayName ?? (effective.model || "Model")}${effective.effort ? ` · ${effective.effort}` : ""}`;
  return (
    <>
      <button className="icon-btn gauge-btn" aria-label={`Model: ${label}`} title={label} disabled={disabled} onClick={() => setSheet(true)}>
        <svg viewBox="0 0 24 24" width="30" height="30">
          <path d="M4 16 A8 8 0 0 1 20 16" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M4 16 A8 8 0 0 1 20 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" pathLength="1" strokeDasharray={`${level} 1`} className="gauge-fill" />
          <g transform={`rotate(${angle} 12 16)`}>
            <line x1="12" y1="16" x2="12" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </g>
          <circle cx="12" cy="16" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {sheet && <ModelSheet session={session} onClose={() => setSheet(false)} />}
    </>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function fmtK(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
}
