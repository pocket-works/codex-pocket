// Minimal Cloudflare DNS client: enough to keep one A record current and to
// answer ACME dns-01 challenges. Other providers implement DnsProvider.
export interface DnsProvider {
  /** Returns true when a write happened, false when the record already matched. */
  upsertRecord(zone: string, name: string, type: string, content: string): Promise<boolean>;
  deleteRecord(zone: string, name: string, type: string, content?: string): Promise<boolean>;
}

const API = "https://api.cloudflare.com/client/v4";
const TTL_SECONDS = 60;

interface CfResponse<T> {
  success: boolean;
  result: T;
  errors?: { message: string }[];
}

interface CfRecord {
  id: string;
  content: string;
}

export class CloudflareDns implements DnsProvider {
  private readonly zoneIds = new Map<string, string>();

  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as CfResponse<T>;
    if (!res.ok || !json.success) {
      const msg = json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
      throw new Error(`Cloudflare ${method} ${path}: ${msg}`);
    }
    return json.result;
  }

  private async zoneId(zone: string): Promise<string> {
    const cached = this.zoneIds.get(zone);
    if (cached) return cached;
    const zones = await this.call<{ id: string }[]>("GET", `/zones?name=${encodeURIComponent(zone)}`);
    if (zones.length === 0) throw new Error(`Cloudflare zone ${zone} not found (check the token's zone permissions)`);
    this.zoneIds.set(zone, zones[0].id);
    return zones[0].id;
  }

  private async records(zoneId: string, name: string, type: string): Promise<CfRecord[]> {
    return this.call<CfRecord[]>("GET", `/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
  }

  async upsertRecord(zone: string, name: string, type: string, content: string): Promise<boolean> {
    const zoneId = await this.zoneId(zone);
    const existing = await this.records(zoneId, name, type);
    const payload = { type, name, content, ttl: TTL_SECONDS, proxied: false };
    if (existing.length === 0) {
      await this.call("POST", `/zones/${zoneId}/dns_records`, payload);
      return true;
    }
    if (existing[0].content === content) return false;
    await this.call("PUT", `/zones/${zoneId}/dns_records/${existing[0].id}`, payload);
    return true;
  }

  async deleteRecord(zone: string, name: string, type: string, content?: string): Promise<boolean> {
    const zoneId = await this.zoneId(zone);
    const matches = (await this.records(zoneId, name, type)).filter((r) => content === undefined || r.content === content);
    for (const r of matches) await this.call("DELETE", `/zones/${zoneId}/dns_records/${r.id}`);
    return matches.length > 0;
  }
}
