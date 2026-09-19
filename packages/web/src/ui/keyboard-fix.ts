// iOS Safari/Chrome shift the whole page up when the on-screen keyboard
// covers a focused input, and often leave it shifted after the keyboard goes
// away, so absolutely positioned bars end up floating mid-screen. The app
// never scrolls the document itself, so snapping back to the origin on blur
// is always safe.
export function installKeyboardFix(): void {
  document.addEventListener("focusout", () => {
    requestAnimationFrame(() => window.scrollTo(0, 0));
  });
}
