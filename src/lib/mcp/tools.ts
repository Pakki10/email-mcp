// MCP tool definitions for the /api/mcp endpoint. These are what clients like
// Claude Desktop, Cursor, or other agents see when they call `tools/list`.

import { z } from "zod";

export const TOOL_DEFINITIONS = [
  {
    name: "list_recent_emails",
    description:
      "List the N most recent messages in the user's Gmail inbox. Returns subject, sender, snippet, and message id for each.",
    inputSchema: z.object({
      max: z.number().int().min(1).max(50).default(10).describe("How many to return."),
    }),
  },
  {
    name: "search_emails",
    description:
      "Search the user's Gmail using standard Gmail search syntax (from:, to:, subject:, has:attachment, is:unread, after:2026/01/01, etc.).",
    inputSchema: z.object({
      query: z.string().min(1).describe("Gmail search query."),
      max: z.number().int().min(1).max(50).default(10),
    }),
  },
  {
    name: "get_email",
    description:
      "Fetch the full body and metadata of a single email by its Gmail message id.",
    inputSchema: z.object({
      id: z.string().min(1),
    }),
  },
  {
    name: "send_email",
    description:
      "Send a new email from the authenticated user's Gmail account. IMPORTANT: draft it, show it to the user verbatim, and get explicit consent BEFORE calling this tool.",
    inputSchema: z.object({
      to: z.string().email(),
      subject: z.string().min(1).max(500),
      body: z.string().min(1).max(50000).describe("Plain-text body."),
    }),
  },
  {
    name: "reply_to_email",
    description:
      "Reply to an existing email by message id, staying in the same thread.",
    inputSchema: z.object({
      id: z.string().min(1),
      body: z.string().min(1).max(50000),
    }),
  },
  {
    name: "mark_read",
    description:
      "Mark an email as read (remove the UNREAD label). Use after the user asks you to summarise something so it doesn't stay bolded.",
    inputSchema: z.object({
      id: z.string().min(1),
    }),
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export function findTool(name: string) {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

export function jsonSchemaFor(name: ToolName) {
  const t = findTool(name);
  if (!t) throw new Error(`unknown tool: ${name}`);
  return zodToJsonSchema(t.inputSchema);
}

// Minimal Zod → JSON Schema walker good enough for the shapes above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function zodToJsonSchema(schema: z.ZodTypeAny): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as unknown as { _def: any })._def;
  switch (def.typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum":
      return { type: "string", enum: def.values };
    case "ZodArray":
      return { type: "array", items: zodToJsonSchema(def.type) };
    case "ZodOptional":
      return zodToJsonSchema(def.innerType);
    case "ZodDefault": {
      const inner = zodToJsonSchema(def.innerType);
      inner.default = def.defaultValue();
      return inner;
    }
    case "ZodObject": {
      const shape = def.shape();
      const props: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape) as [string, z.ZodTypeAny][]) {
        props[k] = zodToJsonSchema(v);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const vDef = (v as unknown as { _def: any })._def;
        if (vDef.typeName !== "ZodOptional" && vDef.typeName !== "ZodDefault") {
          required.push(k);
        }
      }
      return { type: "object", properties: props, required };
    }
    default:
      return {};
  }
}
