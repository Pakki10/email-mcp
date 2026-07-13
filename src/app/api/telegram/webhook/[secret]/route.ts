// Telegram bot webhook.
//
// URL shape: /api/telegram/webhook/<secret> where <secret> maps to a user via
// the TelegramLink table. When the user creates their bot in the dashboard
// we mint a fresh random secret and register the URL with Telegram's
// setWebhook. Because the secret is per-user, one leaked bot token can't be
// pointed at a different user's account.
//
// The first inbound message binds chatId to the user. After that, every
// message from that chatId is routed through the brain and answered.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendMessage, type TelegramUpdate } from "@/lib/telegram";
import { respondToMessage } from "@/lib/brain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params;
  const link = await prisma.telegramLink.findUnique({ where: { webhookSecret: secret } });
  if (!link) {
    // Return 200 anyway so Telegram doesn't back off and eventually disable
    // the webhook — we just silently ignore unknown secrets.
    return NextResponse.json({ ok: true });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const msg = update?.message;
  if (!msg?.text) return NextResponse.json({ ok: true });

  // Bind chatId on first message.
  const chatId = String(msg.chat.id);
  if (!link.chatId || link.chatId !== chatId) {
    await prisma.telegramLink.update({
      where: { id: link.id },
      data: { chatId },
    });
  }

  // Ignore /start — just acknowledge and stop. /start is Telegram's onboarding
  // command; we don't want it to hit the LLM.
  if (msg.text.trim() === "/start") {
    await sendMessage(link.botToken, chatId, [
      "Connected to email-mcp. I can read and send email from your Gmail.",
      "",
      "Try:",
      "• `show me my last 5 emails`",
      "• `any unread from stripe?`",
      "• `send an email to alex@example.com saying dinner at 7`",
    ].join("\n")).catch(() => undefined);
    return NextResponse.json({ ok: true });
  }

  // Kick off the brain but DON'T await it inside the request path — Telegram
  // retries webhooks that take >20s, so we ack fast and reply out-of-band.
  respondToMessage(link.userId, msg.text)
    .then((reply) => sendMessage(link.botToken, chatId, reply))
    .catch(async (err) => {
      await sendMessage(link.botToken, chatId, `Something broke: ${(err as Error).message}`)
        .catch(() => undefined);
    });

  return NextResponse.json({ ok: true });
}
