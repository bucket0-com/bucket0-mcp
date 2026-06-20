/**
 * The six AgentBucket MCP tools (remote/Worker variant). Same surface as the
 * `agentbucket` stdio package; here each handler gets a per-session client built
 * from the Bearer token on the connection (see index.ts).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentBucketClient } from "./client.js";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

export function registerTools(server: McpServer, getClient: () => AgentBucketClient): void {
  server.registerTool(
    "save_file",
    {
      description:
        "Save a file to the user's Bucket0 AgentBucket. Use it for any output the user may want to keep, share, or reference later (documents, data, code, notes). On paid plans the text is indexed so you can recall it later with search_memory. Set index=false for scratch/throwaway files. Use forward slashes in path to place files in folders.",
      inputSchema: {
        path: z.string().describe("File path, e.g. reports/q3-summary.md"),
        content: z.string().describe("The file contents (text)."),
        index: z
          .boolean()
          .optional()
          .describe("Index this file for semantic memory (default true). Set false for scratch files."),
      },
    },
    async ({ path, content, index }) => {
      try {
        const r = await getClient().saveFile(path, content, index !== false);
        return ok(`Saved "${r.key}" (${r.size} bytes, destination: ${r.destination}).`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "search_memory",
    {
      description:
        "Search the user's saved AgentBucket files by meaning (semantic search). Use this BEFORE regenerating work, to find something you (or a past session) already produced. Returns the most relevant snippets and their source file. Requires a paid Bucket0 plan.",
      inputSchema: {
        query: z.string().describe("Natural-language description of what you're looking for."),
        limit: z.number().int().positive().optional().describe("Max results (default 8)."),
      },
    },
    async ({ query, limit }) => {
      try {
        const r = await getClient().searchMemory(query, limit ?? 8);
        const results = r.results || [];
        if (results.length === 0) return ok("No matching memory found.");
        return ok(
          results
            .map((x, i) => `${i + 1}. ${x.fileName} (score ${x.score.toFixed(2)})\n   ${x.snippet}`)
            .join("\n\n")
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "read_file",
    {
      description: "Read back the full contents of a text file you previously saved to AgentBucket.",
      inputSchema: { path: z.string().describe("File path/key, e.g. reports/q3-summary.md") },
    },
    async ({ path }) => {
      try {
        return ok(await getClient().readFile(path));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "list_files",
    {
      description: "List the files stored in the user's AgentBucket, optionally filtered to a folder.",
      inputSchema: {
        folder: z.string().optional().describe("Optional folder prefix to filter by, e.g. reports/"),
        page: z.number().int().positive().optional().describe("Page number (default 1)."),
      },
    },
    async ({ folder, page }) => {
      try {
        const r = await getClient().listFiles(folder, page ?? 1);
        if (r.files.length === 0) return ok("No files found.");
        return ok(r.files.map((f) => `${f.key} (${f.size} bytes)`).join("\n"));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "delete_file",
    {
      description: "Delete a file from AgentBucket. Only do this when the user explicitly asks you to.",
      inputSchema: { path: z.string().describe("File path/key to delete.") },
    },
    async ({ path }) => {
      try {
        await getClient().deleteFile(path);
        return ok(`Deleted "${path}".`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "create_folder",
    {
      description: "Create an empty folder in AgentBucket. Optional — saving to a nested path auto-creates folders.",
      inputSchema: { path: z.string().describe("Folder path, e.g. reports/2026") },
    },
    async ({ path }) => {
      try {
        const r = await getClient().createFolder(path);
        return ok(`Created folder "${r.path}".`);
      } catch (e) {
        return fail(e);
      }
    }
  );
}
