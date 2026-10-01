import { useDialog } from "./dialog.js";

export function AboutSheet({ onClose }: { onClose: () => void }) {
  const dialog = useDialog("About Codex Pocket", onClose);
  return <div className="sheet-backdrop" onClick={onClose}>
    <div className="sheet about-sheet" ref={dialog.ref} {...dialog.props} onClick={(event) => event.stopPropagation()}>
      <div className="sheet-grip" />
      <div className="computer-sheet-heading"><h2>About</h2><button className="icon-btn" aria-label="Close" title="Close" onClick={onClose}>×</button></div>
      <div className="about-identity"><img src="/icon.svg?v=2" alt="" width={48} height={48} /><h3>Codex Pocket</h3></div>
      <div className="setting-row"><span>Phone app version</span><span className="setting-value muted">{import.meta.env.VITE_APP_VERSION}</span></div>
    </div>
  </div>;
}
