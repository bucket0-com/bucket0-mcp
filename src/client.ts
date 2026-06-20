/**
 * Thin client over the Bucket0 AgentBucket REST API.
 * Forwards each call with the user's Bearer key. No storage logic lives here —
 * all auth, quotas, encryption, and memory indexing stay server-side at Bucket0.
 * Uses only Web-standard APIs (fetch / FormData / Blob), so it runs on Workers.
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

export class AgentBucketClient {
  constructor(private apiKey: string, private baseUrl: string) {}

  private auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private async asJson(res: Response): Promise<any> {
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error ? `${res.status}: ${body.error}` : `HTTP ${res.status}`);
    }
    return body;
  }

  async saveFile(path: string, content: string, index = true) {
    const form = new FormData();
    form.append("file", new Blob([content]), path.split("/").pop() || path);
    form.append("filename", path);
    if (!index) form.append("index", "false");
    const res = await fetch(`${this.baseUrl}/files/upload`, {
      method: "POST",
      headers: this.auth(),
      body: form,
    });
    return this.asJson(res) as Promise<{ key: string; fileName: string; size: number; destination: string }>;
  }

  async searchMemory(query: string, limit = 8) {
    const res = await fetch(`${this.baseUrl}/memory/search`, {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ query, topK: limit }),
    });
    return this.asJson(res) as Promise<{ results: MemoryHit[] }>;
  }

  async readFile(path: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/files/download?key=${encodeURIComponent(path)}`, {
      headers: this.auth(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${res.status}: ${detail || "download failed"}`);
    }
    return res.text();
  }

  async listFiles(folder?: string, page = 1) {
    const res = await fetch(`${this.baseUrl}/files?page=${page}&pageSize=100`, {
      headers: this.auth(),
    });
    const data = (await this.asJson(res)) as { files: AgentFile[]; pagination?: unknown };
    let files = data.files || [];
    if (folder) {
      const prefix = folder.endsWith("/") ? folder : `${folder}/`;
      files = files.filter((f) => f.key.startsWith(prefix));
    }
    return { files, pagination: data.pagination };
  }

  async deleteFile(path: string) {
    const res = await fetch(`${this.baseUrl}/files?key=${encodeURIComponent(path)}`, {
      method: "DELETE",
      headers: this.auth(),
    });
    return this.asJson(res);
  }

  async createFolder(path: string) {
    const res = await fetch(`${this.baseUrl}/files/folder`, {
      method: "POST",
      headers: { ...this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    return this.asJson(res) as Promise<{ path: string }>;
  }
}
