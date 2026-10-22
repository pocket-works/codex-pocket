export function developmentVersion(version: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${version}-dev.${stamp}`;
}

export function developmentVersionAt(version: string, stamp: string): string {
  if (!/^\d{8}T\d{6}Z$/.test(stamp)) throw new Error(`Invalid development build timestamp: ${stamp}`);
  return `${version}-dev.${stamp}`;
}
