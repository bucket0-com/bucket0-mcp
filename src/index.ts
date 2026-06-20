/**
 * bucket0-mcp — remote MCP server (Cloudflare Worker) for Bucket0 AgentBucket.
 *
 * Connect from any remote-MCP host (Claude, ChatGPT, Perplexity, …) at:
 *   https://mcp.bucket0.com/mcp
 * with header:  Authorization: Bearer b0ak_...
 *
 * v1 auth: the Bearer token is read from the incoming request and passed to the
 * agent via ctx.props; tools forward it to the AgentBucket REST API. (OAuth is v2.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { AgentBucketClient } from "./client.js";
import { registerTools } from "./tools.js";

export interface Env {
  BUCKET_MCP: DurableObjectNamespace;
  /** Override the AgentBucket API base (defaults to production). */
  AGENT_BUCKET_BASE_URL?: string;
}

type Props = { apiKey: string };

const DEFAULT_BASE = "https://bucket0.com/api/agent-bucket";

export class BucketMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: "agentbucket", version: "0.1.0" });

  async init(): Promise<void> {
    const baseUrl = this.env.AGENT_BUCKET_BASE_URL || DEFAULT_BASE;
    registerTools(this.server, () => new AgentBucketClient(this.props?.apiKey ?? "", baseUrl));
  }
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        "agentbucket MCP server. Connect an MCP client to /mcp with header: Authorization: Bearer b0ak_...\n",
        { status: 200, headers: { ...CORS, "content-type": "text/plain" } }
      );
    }

    if (url.pathname.startsWith("/mcp")) {
      const authHeader = request.headers.get("Authorization") ?? "";
      const token = /^bearer\s+/i.test(authHeader) ? authHeader.replace(/^bearer\s+/i, "").trim() : "";
      if (!token.startsWith("b0ak_")) {
        return new Response(
          JSON.stringify({ error: "Missing or invalid Bearer token. Use Authorization: Bearer b0ak_..." }),
          { status: 401, headers: { ...CORS, "content-type": "application/json" } }
        );
      }
      // Pass the validated key to the agent session.
      (ctx as ExecutionContext & { props: Props }).props = { apiKey: token };

      const res = await BucketMCP.serve("/mcp", { binding: "BUCKET_MCP" }).fetch(request, env, ctx);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    return new Response("Not found", { status: 404, headers: CORS });
  },
};
