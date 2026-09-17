import { networkInterfaces } from "node:os";

// RFC 1918 ranges plus Tailscale's CGNAT block; anything else is not a LAN
// address a phone could reach.
export function isLanAddress(addr: string): boolean {
  if (addr.startsWith("10.") || addr.startsWith("192.168.")) return true;
  const second = Number(addr.split(".")[1]);
  if (addr.startsWith("172.")) return second >= 16 && second <= 31;
  if (addr.startsWith("100.")) return second >= 64 && second <= 127;
  return false;
}

export function lanAddresses(ifaces = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && isLanAddress(a.address)) out.push(a.address);
    }
  }
  return out;
}

export function primaryLanAddress(): string | null {
  return lanAddresses()[0] ?? null;
}
