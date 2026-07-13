import Link from "next/link";
import { auth } from "@/lib/auth";
import { SignInButton } from "./signin-button";

const CONFIG_SNIPPET = `{
  "mcpServers": {
    "email": {
      "url": "https://email.regiq.in/api/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_KEY>"
      }
    }
  }
}`;

export default async function LandingPage() {
  const session = await auth().catch(() => null);
  const signedIn = !!session?.user;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-14">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-400" />
          MCP · streamable-http · Telegram
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          email-mcp
        </h1>
        <p className="mt-4 max-w-xl text-lg text-neutral-400">
          Give any AI agent — or your own Telegram bot — read and send access
          to your Gmail. One Google sign-in, one MCP URL, one bot token. No
          IMAP passwords, no app-passwords, no scraping.
        </p>
        <div className="mt-8 flex gap-3">
          {signedIn ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-teal-400"
            >
              Open dashboard →
            </Link>
          ) : (
            <SignInButton />
          )}
          <Link
            href="https://github.com/globalion/email-mcp"
            target="_blank"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-2.5 text-sm text-neutral-200 hover:bg-neutral-800"
          >
            GitHub ↗
          </Link>
        </div>
      </div>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Two ways to use it
        </h2>
        <ul className="space-y-3 text-neutral-300">
          <li>
            <b className="text-neutral-100">Any MCP client.</b> Claude Desktop,
            Cursor, Windsurf — paste the URL, get{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">list_recent_emails</code>,{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">search_emails</code>,{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-teal-300">send_email</code>{" "}
            as tools.
          </li>
          <li>
            <b className="text-neutral-100">Your own Telegram bot.</b> Create
            a bot with @BotFather, paste the token in the dashboard, then
            message the bot in plain English —{" "}
            <span className="text-neutral-400">
              &quot;what&apos;s in my inbox&quot;, &quot;reply to alex saying yes&quot;, &quot;send an email
              to my mum with the recipe&quot;.
            </span>
          </li>
        </ul>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Claude Desktop config
        </h2>
        <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-xs leading-relaxed text-neutral-200">
          {CONFIG_SNIPPET}
        </pre>
      </section>

      <section className="mb-12">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">
          Free
        </h2>
        <p className="text-neutral-300">
          Gmail API is free — every user reads and sends against their own
          Google quota (1B units/day, ≈ tens of thousands of emails). Hosted
          service is free too. Self-host if you don&apos;t want us in the loop.
        </p>
      </section>

      <footer className="mt-16 border-t border-neutral-800 pt-6 text-xs text-neutral-500">
        Built by{" "}
        <Link href="https://github.com/Shreyas-Profile" target="_blank" className="underline">
          Shreyas
        </Link>{" "}
        · Shipped by{" "}
        <Link href="https://github.com/globalion" target="_blank" className="underline">
          Globalion
        </Link>{" "}
        · MIT
      </footer>
    </main>
  );
}
