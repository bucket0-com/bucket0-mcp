/**
 * OAuth default handler for the Worker. It is the OAuth Authorization Server's
 * "login + consent" surface, but it delegates the actual user auth to bucket0.com
 * (the upstream IdP, where Clerk lives):
 *
 *   /authorize  -> validate the OAuth request, then redirect the user's browser to
 *                  bucket0.com/oauth/consent with the request encoded in `state`.
 *   /callback   -> bucket0 redirects back with a one-time `code` (+ HMAC `sig`). The
 *                  code is an AES-GCM blob (encrypted with the shared secret) holding
 *                  the user's id + a freshly-minted b0ak_ key. Verify the signature,
 *                  decrypt, check freshness, then completeAuthorization with the key as
 *                  `props` (the key is only ever transmitted as ciphertext).
 */

import { hmacVerify, decryptCode, b64urlEncode, b64urlDecode } from "./crypto.js";

interface AuthRequest {
  clientId: string;
  redirectUri: string;
  scope: string[];
  state: string;
  [k: string]: unknown;
}

interface OAuthHelpers {
  parseAuthRequest(request: Request): Promise<AuthRequest>;
  lookupClient(clientId: string): Promise<{ clientName?: string } | null>;
  completeAuthorization(opts: {
    request: AuthRequest;
    userId: string;
    scope: string[];
    metadata?: Record<string, unknown>;
    props: Record<string, unknown>;
  }): Promise<{ redirectTo: string }>;
}

interface AuthEnv {
  OAUTH_PROVIDER: OAuthHelpers;
  OAUTH_BRIDGE_SECRET: string;
  BUCKET0_WEB_URL?: string;
}

const WEB = (env: AuthEnv) => env.BUCKET0_WEB_URL || "https://bucket0.com";
const SCOPE = ["agentbucket"];

// Connector icon (advertised via serverInfo.icons). The bucket0 mark, white on a
// violet->rose brand tile, so it reads on any client background.
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a5cc7"/><stop offset="1" stop-color="#c76d92"/></linearGradient></defs>
<rect width="512" height="512" rx="112" fill="url(#g)"/>
<g transform="translate(106,106) scale(3)" fill="#ffffff">
<path d="m94.9 52.6c0.5-2-2.3-3.2-3.6-3.8l-0.1-0.1h-0.1l-1.6 2 1.2 0.6c0.8 0.5 1.4 1.3 0.2 2l-8.2 4h-13.2l0.3 2.3h11.2l-6.2 26.4c-0.8 2.8-3.2 5.2-7.1 5.2h-35.7c-2.8 0-5.7-1.8-6.8-5.2l-6.7-26.3 11.3-0.1 0.2-2.2h-12.8l-8.3-4.2c-0.9-0.6-0.9-1.3-0.1-1.7s3.4-1.1 3.4-1.1l-1.8-2.3c-1.7 0.5-6.3 1.5-5.6 4.5l0.1 0.1c2.6 8.3 10.5 32.4 12.1 36.9 1.7 4.5 6.1 8.9 11.8 8.9h41.6c6 0 10.4-3.8 12.2-8 1.4-3.4 8.9-25.9 12.3-37.9z"/>
<path d="m27 20.5h0.3c1.7-9.4 10.1-18.6 22.5-18.5 12.4 0 22.8 8.7 23.8 21.1 0.8-0.1 1.6-0.1 2.3-0.1 8.6 0 14 6.8 15.2 12.8 1.1 7.8-4 17.7-15.1 18.3h-7.2c-1.4-4.5-6.7-13.2-18.7-13.4-11.9-0.1-17.6 8.7-19.2 13.4h-3.8c-9.6 0.1-16.9-7.4-16.9-16.9-0.1-7.7 6.5-16.6 16.8-16.7z"/>
<path d="m49.5 52.7c-6.3 0-10.6 5.5-10.6 10.5v10.6c0 4.9 3.7 10.7 10.6 10.7 6.9 0.1 11.1-5.4 11.1-10.4v-10.9c0-4.8-3.8-10.6-11.1-10.5zm5.4 21.4c0 2.4-2.1 5-5.3 5s-5.1-2.5-5.1-5.1v-10.8c0-2.8 2.3-5.2 5.1-5.2 3.7 0 5.3 2.8 5.3 5.3v10.8z"/>
</g></svg>`;

export const authHandler = {
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(request.url);

    // Step 1: a host (Claude/ChatGPT) starts the OAuth flow.
    if (url.pathname === "/authorize") {
      const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);

      // Encode the (already-validated) OAuth request to carry across the round-trip.
      const state = b64urlEncode(JSON.stringify(oauthReq));
      const consent = new URL("/oauth/consent", WEB(env));
      consent.searchParams.set("state", state);
      consent.searchParams.set("client", client?.clientName || "An MCP client");
      consent.searchParams.set("callback", `${url.origin}/callback`);
      return Response.redirect(consent.toString(), 302);
    }

    // Step 2: bucket0.com returns here after the user authenticates + consents.
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code") || "";
      const state = url.searchParams.get("state") || "";
      const sig = url.searchParams.get("sig") || "";
      if (!code || !state || !sig) {
        return new Response("Missing callback parameters", { status: 400 });
      }
      // The signature proves the callback came from bucket0.com (shared secret).
      if (!(await hmacVerify(env.OAUTH_BRIDGE_SECRET, `${code}.${state}`, sig))) {
        return new Response("Invalid callback signature", { status: 400 });
      }

      // Decrypt the one-time code -> { userId, apiKey, exp }. AES-GCM authenticates it.
      let userId: string;
      let apiKey: string;
      try {
        const payload = JSON.parse(await decryptCode(env.OAUTH_BRIDGE_SECRET, code)) as {
          userId: string;
          apiKey: string;
          exp?: number;
        };
        if (typeof payload.exp === "number" && Date.now() > payload.exp) {
          return new Response("Authorization code expired", { status: 400 });
        }
        userId = payload.userId;
        apiKey = payload.apiKey;
      } catch {
        return new Response("Invalid authorization code", { status: 400 });
      }
      if (!apiKey || !userId) return new Response("Incomplete authorization code", { status: 400 });

      const oauthReq = JSON.parse(b64urlDecode(state)) as AuthRequest;
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReq,
        userId,
        scope: SCOPE,
        metadata: { label: "AgentBucket" },
        props: { apiKey, userId },
      });
      return Response.redirect(redirectTo, 302);
    }

    if (url.pathname === "/icon.svg") {
      return new Response(ICON_SVG, {
        status: 200,
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
      });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        "agentbucket MCP server. Add https://mcp.bucket0.com/mcp as a connector and click Connect.\n",
        { status: 200, headers: { "content-type": "text/plain" } }
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
