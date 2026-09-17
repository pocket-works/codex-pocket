import { getToken } from "./auth.js";

const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

// Phone photos are 12MP+; the model does not need that and the LAN upload
// should stay snappy, so downscale to a JPEG unless the image is already small.
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp|heic)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000 && file.type !== "image/heic") return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode image"))), "image/jpeg", JPEG_QUALITY),
  );
}

/** Uploads an image to the host and returns its path on the Mac. */
export async function uploadImage(file: File): Promise<string> {
  const blob = await shrink(file);
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken() ?? ""}`, "Content-Type": blob.type || file.type },
    body: blob,
  });
  if (!res.ok) throw new Error(res.status === 413 ? "Image is too large" : `Upload failed (HTTP ${res.status})`);
  return ((await res.json()) as { path: string }).path;
}
