/** Keeps the display awake while dictating, when the browser allows it. */
export function keepScreenAwake(): () => void {
  if (!navigator.wakeLock?.request) return () => {};

  let lock: WakeLockSentinel | null = null;
  let pending = false;
  let stopped = false;

  const release = (sentinel: WakeLockSentinel) => {
    void sentinel.release().catch(() => {});
  };

  const acquire = async () => {
    if (stopped || pending || document.visibilityState !== "visible" || (lock && !lock.released)) return;
    pending = true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      // A request can resolve after dictation stopped or the page was hidden.
      if (stopped || document.visibilityState !== "visible") release(sentinel);
      else lock = sentinel;
    } catch {
      // Unsupported policies and power-saving settings must not stop dictation.
    } finally {
      pending = false;
    }
  };

  // Browsers release screen locks when the page is hidden. Restore ours when
  // the user returns to an ongoing dictation session.
  const onVisibilityChange = () => { void acquire(); };
  document.addEventListener("visibilitychange", onVisibilityChange);
  void acquire();

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (lock) release(lock);
    lock = null;
  };
}
