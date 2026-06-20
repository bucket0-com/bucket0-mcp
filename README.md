# bucket0-mcp

Remote **MCP server** (Cloudflare Worker) for **Bucket0 AgentBucket** — a persistent, encrypted file system with semantic memory for AI agents. One URL connects from **Claude, ChatGPT, Perplexity, Grok, Mistral**, and other remote-MCP hosts.

For local (stdio) clients like Claude Code / Cursor, use the [`agentbucket`](https://github.com/bucket0-com/agentbucket) npm package instead.

## Tools

`save_file` · `search_memory` · `read_file` · `list_files` · `delete_file` · `create_folder` — thin handlers over the AgentBucket REST API.

## Auth (v1)

Token-based. The MCP client sends the user's Bucket0 key on the connection:

```
Authorization: Bearer b0ak_...
```

The Worker validates it and forwards it to the AgentBucket API. (OAuth — true zero-paste one-click — is planned for v2.)

## Endpoints

| Path | Purpose |
|---|---|
| `/mcp` | MCP Streamable HTTP transport (connect here) |
| `/` , `/health` | Plain-text status |

## Deploy

```bash
npm install
npm run typecheck                 # type-check
npx wrangler deploy --dry-run     # validate config + bundle (no deploy)
npm run deploy                    # wrangler deploy (requires wrangler login)
```

The `wrangler.jsonc` maps **`mcp.bucket0.com`** to the Worker via a custom domain (requires the `bucket0.com` zone on the same Cloudflare account). Remove the `routes` block to deploy on `*.workers.dev` instead.

### Optional config

| Var | Default |
|---|---|
| `AGENT_BUCKET_BASE_URL` | `https://bucket0.com/api/agent-bucket` |

## Connect a client

In Claude / ChatGPT → add a custom connector → remote MCP server URL:

```
https://mcp.bucket0.com/mcp
```

…and provide the `Authorization: Bearer b0ak_…` header (create the key in the Bucket0 dashboard → AgentBucket → New Key).

## License

MIT
