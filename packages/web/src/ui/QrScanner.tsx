import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

// Live QR reader on the rear camera. iOS has no BarcodeDetector, so frames
// are decoded with jsQR; `onResult` fires once with the first decoded text.
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const scan = () => {
      if (done) return;
      if (ctx && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (hit?.data) {
          done = true;
          onResultRef.current(hit.data);
          return;
        }
      }
      frame = requestAnimationFrame(scan);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        return video.play();
      })
      .then(() => {
        frame = requestAnimationFrame(scan);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));

    return () => {
      done = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner">
      <video ref={videoRef} playsInline muted />
      <div className="scanner-frame" aria-hidden />
      {error && <p className="error scanner-error">{error}</p>}
      <button type="button" className="scanner-close" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
