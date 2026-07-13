# email-mcp

> Built by [**Shreyas**](https://github.com/Shreyas-Profile) · Shipped by [**Globalion**](https://github.com/globalion)

Give any AI agent — or your own Telegram bot — read and send access to your
Gmail. One Google sign-in, one MCP URL, one bot token. No IMAP passwords, no
app-passwords, no scraping.

- **MCP over streamable-HTTP** for Claude Desktop, Cursor, Windsurf, anything.
- **Telegram bot** for chatting to your inbox in natural English.
- **Gmail API** — free, generous per-user quota, official OAuth.

Hosted for free at **[email.regiq.in](https://email.regiq.in)** or self-host
with the Docker Compose below.

## Use it (hosted)

### As an MCP tool

1. Visit https://email.regiq.in and sign in with Google.
2. Copy your API key from the dashboard.
3. Add to Claude Desktop's `claude_desktop_config.json`:

    ```json
    {
      "mcpServers": {
        "email": {
          "url": "https://email.regiq.in/api/mcp",
          "headers": {
            "Authorization": "Bearer YOUR_KEY_HERE"
          }
        }
      }
    }
    ```

4. Restart Claude Desktop. Ask it: *"summarise my last 5 emails and mark them
   read"* or *"reply to Alex saying I can do Tuesday"*.

### As a Telegram bot

1. Sign in at https://email.regiq.in.
2. In Telegram, DM [@BotFather](https://t.me/BotFather) → `/newbot`.
3. Paste the bot token BotFather gives you into the **Telegram bot** panel on
   the dashboard.
4. Open your bot in Telegram, send `/start`, then chat with it.

## Tools

| Tool | Purpose |
|------|---------|
| `list_recent_emails` | Return the N most recent inbox messages. |
| `search_emails` | Gmail search syntax — `from:`, `is:unread`, `has:attachment`, etc. |
| `get_email` | Full body + metadata for one message id. |
| `send_email` | Send a new email. Draft and confirm first. |
| `reply_to_email` | Reply in the same thread as an existing message id. |
| `mark_read` | Remove the UNREAD label. |

## Self-host

You'll need:
- Docker + Compose
- A Google OAuth client — [Cloud Console](https://console.cloud.google.com/apis/credentials)
  - Scopes: `openid`, `email`, `profile`, `gmail.readonly`, `gmail.send`
  - Redirect URI: `<PUBLIC_BASE_URL>/api/auth/callback/google`
- An Anthropic API key — [console.anthropic.com](https://console.anthropic.com/settings/keys)
- A public HTTPS domain if you want Telegram webhooks to work (Telegram
  refuses plain HTTP). Cloudflare Tunnel or `ngrok http 3011` locally.

Then:

```bash
git clone https://github.com/globalion/email-mcp
cd email-mcp
cp .env.example .env
# fill in NEXTAUTH_SECRET, GOOGLE_CLIENT_*, ANTHROPIC_API_KEY, PUBLIC_BASE_URL
docker compose up -d
# open http://localhost:3011
```

## How it works

```
  ┌────────────────┐
  │ Claude Desktop │───► /api/mcp (JSON-RPC 2.0, Bearer <apiKey>)
  │  Cursor, etc   │
  └────────────────┘
  ┌────────────────┐
  │  Telegram bot  │───► /api/telegram/webhook/<secret>
  │  (per user)    │        │
  └────────────────┘        ▼
                       ┌─────────┐
                       │  Brain  │  Claude Haiku picks tool, calls Gmail,
                       │ (Haiku) │  summarises for the user.
                       └────┬────┘
                            ▼
                       ┌─────────┐
                       │  Gmail  │  Per-user OAuth refresh token
                       │   API   │  → short-lived access tokens
                       └─────────┘
```

Every user's Google refresh token stays server-side. The Telegram bot token
is user-scoped — one leaked webhook URL can't be pointed at someone else's
account because the URL segment is a per-user random secret.

## License

MIT. See `LICENSE`.
