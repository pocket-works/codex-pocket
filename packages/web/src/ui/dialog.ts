import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

// What a bottom sheet owes assistive tech and the keyboard: it announces
// itself as a modal dialog, takes focus when it opens, keeps Tab inside,
// closes on Escape when it is dismissable, and hands focus back to
// whatever opened it when it goes away.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  role: "dialog";
  "aria-modal": true;
  "aria-label": string;
  tabIndex: -1;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

export function useDialog(label: string, onClose?: () => void): { ref: RefObject<HTMLDivElement | null>; props: DialogProps } {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    // The sheet itself, not its first control: focusing a <select> or an
    // input on a phone would raise the picker or the keyboard unasked.
    el.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape" && onClose) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return { ref, props: { role: "dialog", "aria-modal": true, "aria-label": label, tabIndex: -1, onKeyDown } };
}
