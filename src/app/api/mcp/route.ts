// MCP-over-HTTP endpoint. Same JSON-RPC 2.0 shape as video-render-mcp so any
// MCP client that already works with that one just needs a URL swap.
//
// Auth: Bearer <apiKey> in the Authorization header.

import { NextResponse } from "next/server";
import { findLiveKey } from "@/lib/keys";
import * as gmail from "@/lib/gmail";
import {
  TOOL_DEFINITIONS,
  findTool,
  jsonSchemaFor,
  type ToolName,
} from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "email-mcp", version: "0.1.0" };

export async function POST(req: Request) {
  const rpc = await req.json().catch(() => null);
  if (!isValidRpc(rpc)) return jsonRpcError(null, -32700, "Parse error");

  if (rpc.method === "initialize") {
    return jsonRpcOk(rpc.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  const auth = req.headers.get("authorization") || "";
  const raw = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const key = raw ? await findLiveKey(raw) : null;
  if (!key) {
    return jsonRpcError(rpc.id, -32001, "Unauthorized — set Authorization: Bearer <key>");
  }
  const userId = key.userId;

  switch (rpc.method) {
    case "tools/list":
      return jsonRpcOk(rpc.id, {
        tools: TOOL_DEFINITIONS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: jsonSchemaFor(t.name),
        })),
      });

    case "tools/call": {
      const { name, arguments: args } = (rpc.params ?? {}) as {
        name?: string;
        arguments?: unknown;
      };
      if (!name) return jsonRpcError(rpc.id, -32602, "Missing tool name");
      const tool = findTool(name);
      if (!tool) return jsonRpcError(rpc.id, -32601, `Unknown tool: ${name}`);

      const parsed = tool.inputSchema.safeParse(args);
      if (!parsed.success) {
        return jsonRpcError(
          rpc.id,
          -32602,
          "Invalid arguments: " + JSON.stringify(parsed.error.flatten()),
        );
      }

      try {
        const result = await runTool(name as ToolName, parsed.data, userId);
        return jsonRpcOk(rpc.id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (err) {
        return jsonRpcOk(rpc.id, {
          isError: true,
          content: [{ type: "text", text: (err as Error).message || String(err) }],
        });
      }
    }

    case "ping":
      return jsonRpcOk(rpc.id, {});

    default:
      return jsonRpcError(rpc.id, -32601, `Method not found: ${rpc.method}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runTool(name: ToolName, args: any, userId: string) {
  switch (name) {
    case "list_recent_emails":
      return gmail.listRecent(userId, args.max);
    case "search_emails":
      return gmail.search(userId, args.query, args.max);
    case "get_email":
      return gmail.getEmail(userId, args.id);
    case "send_email":
      return gmail.sendEmail(userId, args.to, args.subject, args.body);
    case "reply_to_email":
      return gmail.replyToEmail(userId, args.id, args.body);
    case "mark_read":
      await gmail.markRead(userId, args.id);
      return { ok: true };
  }
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

function isValidRpc(x: unknown): x is RpcRequest {
  if (!x || typeof x !== "object") return false;
  const r = x as RpcRequest;
  return r.jsonrpc === "2.0" && typeof r.method === "string";
}

function jsonRpcOk(id: RpcRequest["id"] | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function jsonRpcError(
  id: RpcRequest["id"] | undefined | null,
  code: number,
  message: string,
) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status: code === -32001 ? 401 : 200 },
  );
}
