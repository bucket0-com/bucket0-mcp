# bucket0-mcp

Remote **MCP server** (Cloudflare Worker) for **Bucket0 AgentBucket** — a persistent, encrypted file system with semantic memory for AI agents. One URL connects from **Claude, ChatGPT, Perplexity, Grok, Mistral**, and other remote-MCP hosts.

For local (stdio) clients like Claude Code / Cursor, use the [`agentbucket`](https://github.com/bucket0-com/agentbucket) npm package instead (paste a key, no OAuth).

## Tools

`save_file` · `search_memory` · `read_file` · `list_files` · `delete_file` · `create_folder` — thin handlers over the AgentBucket REST API.

## Auth (v2 — OAuth, zero-paste)

The Worker is its own OAuth 2.1 Authorization Server (via [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)). Hosts add the URL and click **Connect** — no key pasting:

1. The host hits `/authorize`. The Worker redirects the browser to **bucket0.com/oauth/consent**.
2. The user signs in (Clerk) and approves. bucket0.com mints a **revocable `b0ak_` key**, seals it (the user id + key + a 2-min expiry) into an **AES-GCM code** encrypted with a shared secret, and redirects back to `/callback` with an HMAC signature.
3. The Worker verifies the signature, decrypts the code, and completes the grant — the key becomes the session's `props`. The MCP tools forward it to the AgentBucket API.

The key is only ever transmitted as ciphertext. Revoke a connection from **Dashboard → AgentBucket** (delete the `MCP — …` key).

## Endpoints

| Path | Purpose |
|---|---|
| `/mcp` | MCP Streamable HTTP transport (connect here) |
| `/authorize`, `/token`, `/register` | OAuth (handled by the provider) |
| `/callback` | Consent return from bucket0.com |
| `/`, `/health` | Plain-text status |

## Deploy

```bash
npm install
npm run typecheck                 # type-check
npx wrangler deploy --dry-run     # validate config + bundle (no deploy)
```

**One-time setup:**

```bash
# 1. OAuth storage (tokens / grants / clients)
wrangler kv namespace create OAUTH_KV
#    -> paste the returned id into wrangler.jsonc (replaces REPLACE_WITH_KV_ID)

# 2. Shared secret with bucket0.com (must be the SAME value on both sides)
openssl rand -hex 32
wrangler secret put OAUTH_BRIDGE_SECRET     # paste the value
#    -> set the identical value as OAUTH_BRIDGE_SECRET in the bucket0-web env

# 3. Ship
npm run deploy                    # requires wrangler login
```

`wrangler.jsonc` maps **`mcp.bucket0.com`** to the Worker via a custom domain (requires the `bucket0.com` zone on the same Cloudflare account). Remove the `routes` block to deploy on `*.workers.dev` instead.

### Config

| Var | Where | Default |
|---|---|---|
| `OAUTH_BRIDGE_SECRET` | `wrangler secret` (required) | — |
| `BUCKET0_WEB_URL` | `wrangler.jsonc` var | `https://bucket0.com` |
| `AGENT_BUCKET_BASE_URL` | `wrangler.jsonc` var (optional) | `https://bucket0.com/api/agent-bucket` |

The bucket0-web app must set the matching `OAUTH_BRIDGE_SECRET` and serve `/oauth/consent` (and `MCP_WORKER_ORIGIN=https://mcp.bucket0.com`).

## Connect a client

In Claude / ChatGPT → **Add custom connector** → URL:

```
https://mcp.bucket0.com/mcp
```

Leave the OAuth fields blank and click **Connect** → sign in to Bucket0 → **Authorize**. Done.

## License

MIT
