// Gmail API client. Every function takes a userId and looks up that user's
// Google refresh_token from the Account table, then mints a short-lived
// access token via googleapis' OAuth2 helper.
//
// We intentionally keep the surface small: list, search, get, send, reply,
// mark-read. Attachments and drafts are out of scope for v1.

import { google, gmail_v1 } from "googleapis";
import { prisma } from "./db";

type Gmail = gmail_v1.Gmail;

async function gmailFor(userId: string): Promise<Gmail> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { refresh_token: true, access_token: true, expires_at: true },
  });
  if (!account?.refresh_token) {
    throw new Error(
      "Google is not connected for this user, or the account is missing a refresh token. Ask them to sign out and sign back in.",
    );
  }
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2.setCredentials({
    refresh_token: account.refresh_token,
    access_token: account.access_token ?? undefined,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });
  // Persist rotated access tokens so the next call skips the refresh round-trip.
  oauth2.on("tokens", (t) => {
    prisma.account
      .updateMany({
        where: { userId, provider: "google" },
        data: {
          access_token: t.access_token ?? undefined,
          expires_at: t.expiry_date ? Math.floor(t.expiry_date / 1000) : undefined,
        },
      })
      .catch(() => undefined);
  });
  return google.gmail({ version: "v1", auth: oauth2 });
}

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
}

export interface EmailFull extends EmailSummary {
  body: string;
}

export async function listRecent(userId: string, max = 10): Promise<EmailSummary[]> {
  const gmail = await gmailFor(userId);
  const { data } = await gmail.users.messages.list({
    userId: "me",
    maxResults: Math.min(50, Math.max(1, max)),
    q: "in:inbox",
  });
  const ids = (data.messages ?? []).map((m) => m.id!).filter(Boolean);
  return Promise.all(ids.map((id) => summarize(gmail, id)));
}

export async function search(userId: string, query: string, max = 10): Promise<EmailSummary[]> {
  const gmail = await gmailFor(userId);
  const { data } = await gmail.users.messages.list({
    userId: "me",
    maxResults: Math.min(50, Math.max(1, max)),
    q: query,
  });
  const ids = (data.messages ?? []).map((m) => m.id!).filter(Boolean);
  return Promise.all(ids.map((id) => summarize(gmail, id)));
}

export async function getEmail(userId: string, id: string): Promise<EmailFull> {
  const gmail = await gmailFor(userId);
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full",
  });
  const headers = headerMap(data.payload?.headers ?? []);
  return {
    id: data.id!,
    threadId: data.threadId!,
    from: headers.from ?? "",
    to: headers.to ?? "",
    subject: headers.subject ?? "",
    snippet: data.snippet ?? "",
    date: headers.date ?? "",
    unread: (data.labelIds ?? []).includes("UNREAD"),
    body: extractBody(data.payload),
  };
}

export async function sendEmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
): Promise<{ id: string; threadId: string }> {
  const gmail = await gmailFor(userId);
  const raw = encodeRfc2822(to, subject, body);
  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
  return { id: data.id!, threadId: data.threadId! };
}

export async function replyToEmail(
  userId: string,
  messageId: string,
  body: string,
): Promise<{ id: string; threadId: string }> {
  const gmail = await gmailFor(userId);
  const orig = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Message-ID", "References"],
  });
  const headers = headerMap(orig.data.payload?.headers ?? []);
  const to = headers.from ?? "";
  const subject = headers.subject?.startsWith("Re:")
    ? headers.subject
    : `Re: ${headers.subject ?? ""}`;
  const inReplyTo = headers["message-id"];
  const references = [headers.references, inReplyTo].filter(Boolean).join(" ");
  const raw = encodeRfc2822(to, subject, body, {
    "In-Reply-To": inReplyTo,
    References: references,
  });
  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw, threadId: orig.data.threadId ?? undefined },
  });
  return { id: data.id!, threadId: data.threadId! };
}

export async function markRead(userId: string, id: string): Promise<void> {
  const gmail = await gmailFor(userId);
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

// -------- helpers --------

async function summarize(gmail: Gmail, id: string): Promise<EmailSummary> {
  const { data } = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["From", "To", "Subject", "Date"],
  });
  const headers = headerMap(data.payload?.headers ?? []);
  return {
    id: data.id!,
    threadId: data.threadId!,
    from: headers.from ?? "",
    to: headers.to ?? "",
    subject: headers.subject ?? "",
    snippet: data.snippet ?? "",
    date: headers.date ?? "",
    unread: (data.labelIds ?? []).includes("UNREAD"),
  };
}

function headerMap(
  headers: Array<{ name?: string | null; value?: string | null }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    if (h.name && h.value) out[h.name.toLowerCase()] = h.value;
  }
  return out;
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) return decode(payload.body.data);
  // Prefer text/plain; fall back to text/html stripped.
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  }
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/html" && part.body?.data) {
      return decode(part.body.data).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    }
    if (part.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return "";
}

function decode(base64url: string): string {
  return Buffer.from(base64url, "base64url").toString("utf-8");
}

function encodeRfc2822(
  to: string,
  subject: string,
  body: string,
  extraHeaders: Record<string, string | undefined> = {},
): string {
  const headers: string[] = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ];
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v) headers.push(`${k}: ${v}`);
  }
  const message = headers.join("\r\n") + "\r\n\r\n" + body;
  return Buffer.from(message, "utf-8").toString("base64url");
}

function encodeSubject(subject: string): string {
  // ASCII-only subjects go through as-is; non-ASCII gets encoded-word wrapped
  // so Gmail doesn't mojibake it.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
}
