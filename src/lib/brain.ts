// The "brain" that turns a user's Telegram message into Gmail tool calls.
//
// Uses Claude Haiku 4.5 via the Anthropic SDK. The whole flow:
//   1. Send the user's text + tool schemas to Claude
//   2. Claude decides which Gmail tool to call (or replies directly)
//   3. We run the tool, feed the result back, let Claude summarise for the user
//
// One tool loop per message — capped so we can't burn tokens forever on a
// stuck agent. Anthropic charges pennies for Haiku so this stays cheap.

import Anthropic from "@anthropic-ai/sdk";
import * as gmail from "./gmail";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const MAX_TURNS = 4;

const anthropic = new Anthropic();

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "list_recent_emails",
    description:
      "List the N most recent messages in the user's inbox (subject, from, snippet). Use for 'show me my recent emails', 'what's in my inbox', etc.",
    input_schema: {
      type: "object",
      properties: {
        max: { type: "number", description: "How many to return (1-20). Default 5.", default: 5 },
      },
    },
  },
  {
    name: "search_emails",
    description:
      "Search the user's Gmail using standard Gmail search syntax (from:, subject:, has:attachment, is:unread, etc.). Returns matching message summaries.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query." },
        max: { type: "number", description: "Max results (1-20). Default 5.", default: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_email",
    description:
      "Fetch the full body of a single email by its message id (as returned by list_recent_emails or search_emails). Use when the user wants to read a specific email in full.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Gmail message id." },
      },
      required: ["id"],
    },
  },
  {
    name: "send_email",
    description:
      "Send a new email from the user's Gmail. Confirm the exact recipient, subject, and body with the user in plain text BEFORE calling this — no send without an explicit yes.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address." },
        subject: { type: "string" },
        body: { type: "string", description: "Plain-text body. Use \\n for line breaks." },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "reply_to_email",
    description:
      "Reply to an existing email by its message id. Keeps the thread. Confirm content with the user first.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        body: { type: "string" },
      },
      required: ["id", "body"],
    },
  },
];

const SYSTEM = `You are the user's email assistant, running inside their Telegram bot.
Rules:
- Be concise. Telegram messages have a 4096 character cap.
- For inbox listings: markdown bullets, "**subject** — from · snippet". No preamble.
- Never send an email without an explicit "yes" for the exact draft. If asked to send something, draft it verbatim first and ask "Send this?".
- If a tool errors, explain briefly and suggest a fix — don't retry blindly.
- If the user asks something unrelated to email, tell them what you can do.
Available tools: list_recent_emails, search_emails, get_email, send_email, reply_to_email.`;

export async function respondToMessage(userId: string, text: string): Promise<string> {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: text }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });

    if (res.stop_reason !== "tool_use") {
      return extractText(res.content) || "(no reply)";
    }

    const toolUses = res.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      try {
        const out = await runTool(userId, use.name, use.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(out).slice(0, 8000),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: (err as Error).message,
        });
      }
    }
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: toolResults });
  }
  return "I ran out of steps trying to answer that. Try phrasing it more directly.";
}

async function runTool(userId: string, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "list_recent_emails":
      return gmail.listRecent(userId, (args.max as number) ?? 5);
    case "search_emails":
      return gmail.search(userId, String(args.query), (args.max as number) ?? 5);
    case "get_email":
      return gmail.getEmail(userId, String(args.id));
    case "send_email":
      return gmail.sendEmail(userId, String(args.to), String(args.subject), String(args.body));
    case "reply_to_email":
      return gmail.replyToEmail(userId, String(args.id), String(args.body));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function extractText(blocks: Anthropic.Messages.ContentBlock[]): string {
  return blocks
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
