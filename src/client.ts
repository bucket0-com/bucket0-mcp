/**
 * Thin client over the Bucket0 AgentBucket REST API (Worker variant).
 * Forwards each call with the user's Bearer key. No storage logic lives here —
 * all auth, quotas, encryption, and memory indexing stay server-side at Bucket0.
 * Uses only Web-standard APIs (fetch / FormData / Blob / streams), so it runs on Workers.
 * Kept byte-for-byte in sync with the `agentbucket` npm package's client.
 */

export interface AgentFile {
  key: string;
  fileName: string;
  size: number;
  mimeType?: string;
  createdAt?: string;
}

export interface MemoryHit {
  fileName: string;
  key: string;
  chunkIndex: number;
  snippet: string;
  score: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const MAX_INLINE = 256 * 1024; // 256 KB cap on text returned to the agent

export class AgentBucketClient {
  constructor(private apiKey: string, private baseUrl: string) {}

  private auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /** fetch with a hard timeout; maps abort/network failures to readable errors. */
  private async send(path: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s — Bucket0 may be unreachable.`);
      }
      throw new Error(`Network error contacting Bucket0: ${(e as Error)?.message || String(e)}`);
    }
  }

  /** Turn an HTTP status into an actionable message the agent can recover from. */
  private httpError(status: number, detail?: string): Error {
    const friendly: Record<number, string> = {
      401: "Your AgentBucket key is invalid or revoked. Create a new key in the Bucket0 dashboard and reconnect.",
      402: "This needs a paid Bucket0 plan (semantic memory is included on Starter and up).",
      403: "This key isn't allowed to perform that action.",
      404: "Not found.",
      413: "That file exceeds your plan's size limit.",
      429: "Rate limited by Bucket0 — wait a moment and try again.",
    };
    return new Error(friendly[status] || (detail ? `${status}: ${detail}` : `HTTP ${status}`));
  }

  private async asJson(res: Response): Promise<any> {
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw this.httpError(res.status, body?.error);
    return body;
  }

  async saveFile(path: string, content: string, index = true) {
    const form = new FormData();
    form.append("file", new Blob([content]), path.split("/").pop() || path);
    form.append("filename", path);
    if (!index) form.append("index", "false");
    const res = await this.send("/files/upload", { method: "POST", headers: this.auth(), body: form }, UPLOAD_TIMEOUT_MS);
    return this.asJson(res) as Promise<{ key: string; fileName: string; size: number; destination: string }>;
  }

  async searchMemory(query: string, limit = 8) {
    const res = await this.send("/memory/search", {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ query, topK: limit }),
    });
    return this.asJson(res) as Promise<{ results: MemoryHit[] }>;
  }

  async readFile(path: string): Promise<string> {
    const res = await this.send(`/files/download?key=${encodeURIComponent(path)}`, { headers: this.auth() });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw this.httpError(res.status, detail || "download failed");
    }
    const type = res.headers.get("content-type") || "";
    const length = Number(res.headers.get("content-length") || "0");
    const isText =
      type === "" ||
      /^(text\/|application\/(json|xml|x-yaml|yaml|csv|javascript|typescript|markdown|x-ndjson))/i.test(type);
    // Fast path: refuse known-large or known-binary before downloading.
    if (length > MAX_INLINE) {
      return `"${path}" is ${length} bytes — too large to return inline (max ${MAX_INLINE}). Download it directly instead.`;
    }
    if (!isText) {
      return `"${path}" is ${type || "binary"} (${length} bytes) — not returned as text. Download it directly instead.`;
    }
    // Bounded read: never pull more than MAX_INLINE into memory, even with no content-length
    // (protects the Worker's 128 MB limit when the header is absent or chunked).
    const { text, truncated } = await this.readBounded(res, MAX_INLINE);
    return truncated ? text + "\n…[truncated]" : text;
  }

  private async readBounded(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
    const reader = res.body?.getReader();
    if (!reader) {
      const t = await res.text();
      return t.length > max ? { text: t.slice(0, max), truncated: true } : { text: t, truncated: false };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
        if (total > max) {
          truncated = true;
          break;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    const out = new Uint8Array(Math.min(total, max));
    let offset = 0;
    for (const c of chunks) {
      if (offset >= max) break;
      const take = Math.min(c.length, max - offset);
      out.set(c.subarray(0, take), offset);
      offset += take;
    }
    return { text: new TextDecoder().decode(out), truncated };
  }

  async listFiles(folder?: string, page = 1) {
    const res = await this.send(`/files?page=${page}&pageSize=100`, { headers: this.auth() });
    const data = (await this.asJson(res)) as { files: AgentFile[]; pagination?: unknown };
    const raw = data.files || [];
    const hasMore = raw.length >= 100; // a full page implies more may exist
    let files = raw;
    if (folder) {
      const prefix = folder.endsWith("/") ? folder : `${folder}/`;
      files = files.filter((f) => f.key.startsWith(prefix));
    }
    return { files, hasMore, page };
  }

  async deleteFile(path: string) {
    const res = await this.send(`/files?key=${encodeURIComponent(path)}`, { method: "DELETE", headers: this.auth() });
    return this.asJson(res);
  }

  async createFolder(path: string) {
    const res = await this.send("/files/folder", {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return this.asJson(res) as Promise<{ path: string }>;
  }
}
