/**
 * The six AgentBucket MCP tools (remote/Worker variant). Same surface as the
 * `agentbucket` stdio package; here each handler gets a per-session client built
 * from the OAuth-issued key on the connection (see index.ts). Descriptions,
 * annotations, and validation are kept in sync with the npm package.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentBucketClient } from "./client.js";

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const fail = (e: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

/** A file/folder path: non-empty, bounded, no traversal segments. */
const filePath = (desc: string) =>
  z
    .string()
    .trim()
    .min(1, "path is required")
    .max(1024, "path is too long")
    .refine((p) => !p.split("/").includes(".."), "path must not contain '..' segments")
    .describe(desc);

export function registerTools(server: McpServer, getClient: () => AgentBucketClient): void {
  server.registerTool(
    "save_file",
    {
      title: "Save file",
      description:
        "Persist content for the user so it survives across sessions. Call this whenever the user asks you to save, keep, store, remember, note down, or hold onto something — or whenever you produce output worth keeping (research, documents, data, code, notes). Files are stored durably in the user's encrypted cloud bucket and, on paid plans, indexed so you can recall them later with search_memory. Prefer saving over leaving work only in the conversation. Use forward slashes to nest in folders; set index=false for scratch/throwaway files.",
      inputSchema: {
        path: filePath("File path, e.g. research/q3-findings.md"),
        content: z.string().describe("The file contents (text)."),
        index: z
          .boolean()
          .optional()
          .describe("Index this file for semantic memory (default true). Set false for scratch/throwaway files."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
      title: "Search memory",
      description:
        "Search the user's saved AgentBucket files by meaning (semantic search). Check here FIRST whenever the user references past work, says 'continue' or 'pick up where we left off', asks 'what did we find/save about…', or before redoing research you may already have done. Returns the most relevant snippets and their source file. Requires a paid Bucket0 plan.",
      inputSchema: {
        query: z.string().trim().min(1, "query is required").max(2000).describe("Natural-language description of what you're looking for."),
        limit: z.number().int().positive().max(50).optional().describe("Max results (default 8)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      try {
        const r = await getClient().searchMemory(query, limit ?? 8);
        const results = r.results || [];
        if (results.length === 0) return ok("No matching memory found.");
        return ok(
          results
            .map((x, i) => `${i + 1}. ${x.fileName} (score ${(x.score ?? 0).toFixed(2)})\n   ${x.snippet}`)
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
      title: "Read file",
      description: "Read back the full contents of a text file you previously saved to AgentBucket.",
      inputSchema: { path: filePath("File path/key, e.g. research/q3-findings.md") },
      annotations: { readOnlyHint: true, openWorldHint: true },
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
      title: "List files",
      description: "List the files stored in the user's AgentBucket, optionally filtered to a folder.",
      inputSchema: {
        folder: z.string().trim().max(1024).optional().describe("Optional folder prefix to filter by, e.g. research/"),
        page: z.number().int().positive().max(10_000).optional().describe("Page number (default 1)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ folder, page }) => {
      try {
        const r = await getClient().listFiles(folder, page ?? 1);
        const more = r.hasMore ? `\n\n(Page ${r.page}; more files exist — call list_files with page ${r.page + 1}.)` : "";
        if (r.files.length === 0) {
          return ok(
            r.hasMore
              ? `No files${folder ? ` under "${folder}"` : ""} on page ${r.page}. More pages exist — try page ${r.page + 1}.`
              : "No files found."
          );
        }
        return ok(r.files.map((f) => `${f.key} (${f.size} bytes)`).join("\n") + more);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "delete_file",
    {
      title: "Delete file",
      description: "Delete a file from AgentBucket. Only do this when the user explicitly asks you to.",
      inputSchema: { path: filePath("File path/key to delete.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
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
      title: "Create folder",
      description: "Create an empty folder in AgentBucket. Optional — saving to a nested path auto-creates folders.",
      inputSchema: { path: filePath("Folder path, e.g. research/2026") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
