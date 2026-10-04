import { useState } from "react";
import { DownloadIcon, XIcon } from "./icons.js";
import { useDialog } from "./dialog.js";

export function PreviewImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`image-preview-trigger ${className ?? ""}`} aria-label={`Preview ${alt || "image"}`} onClick={() => setOpen(true)}>
      <img src={src} alt={alt} />
    </button>
    {open && <ImageViewer src={src} alt={alt} onClose={() => setOpen(false)} />}
  </>;
}

export function ImageViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const dialog = useDialog(alt || "Image preview", onClose);
  return <div className="image-viewer-backdrop" onClick={onClose}>
    <section ref={dialog.ref} {...dialog.props} className="image-viewer" onClick={(e) => e.stopPropagation()}>
      <header className="image-viewer-header">
        <strong title={alt}>{alt || "Image"}</strong>
        <div>
          <a className="pdf-download" href={src} download={alt || "image"} aria-label={`Download ${alt || "image"}`}><DownloadIcon />Download</a>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close image preview" title="Close image preview"><XIcon /></button>
        </div>
      </header>
      <div className="image-viewer-content" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}><img src={src} alt={alt} /></div>
    </section>
  </div>;
}
