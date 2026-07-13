import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "email-mcp — Read and send Gmail from any AI agent or Telegram",
  description:
    "MCP server + Telegram bot for Gmail. Sign in with Google, drop the URL into Claude Desktop or Cursor, or chat with your own Telegram bot in natural language.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
