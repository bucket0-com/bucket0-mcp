/**
 * bucket0-mcp — remote MCP server (Cloudflare Worker) for Bucket0 AgentBucket.
 *
 * v2: OAuth. The Worker is an OAuth Authorization Server (via workers-oauth-provider)
 * and an MCP resource. Hosts (Claude, ChatGPT, …) add https://mcp.bucket0.com/mcp and
 * click Connect — login + consent happen on bucket0.com (Clerk), which mints a
 * revocable b0ak_ key. That key arrives as the grant's `props`, and the MCP tools
 * forward it to the AgentBucket REST API. No key pasting.
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { AgentBucketClient } from "./client.js";
import { registerTools } from "./tools.js";
import { authHandler } from "./auth.js";

export interface Env {
  BUCKET_MCP: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
  AGENT_BUCKET_BASE_URL?: string;
}

type Props = { apiKey: string; userId?: string };

const DEFAULT_BASE = "https://bucket0.com/api/agent-bucket";

export class BucketMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "agentbucket",
    version: "0.3.0",
    title: "AgentBucket",
    websiteUrl: "https://bucket0.com",
    icons: [{ src: "https://mcp.bucket0.com/icon.svg", mimeType: "image/svg+xml", sizes: ["any"] }],
  });

  async init(): Promise<void> {
    const baseUrl = this.env.AGENT_BUCKET_BASE_URL || DEFAULT_BASE;
    registerTools(this.server, () => new AgentBucketClient(this.props?.apiKey ?? "", baseUrl));
  }
}

export default new OAuthProvider({
  apiRoute: "/mcp",
  // McpAgent serves MCP; the provider gates it on a valid token and injects grant props.
  // serve() defaults to a binding named MCP_OBJECT; ours is BUCKET_MCP.
  apiHandler: BucketMCP.serve("/mcp", { binding: "BUCKET_MCP" }) as never,
  defaultHandler: authHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["agentbucket"],
});
