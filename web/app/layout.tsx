import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Web Interface",
  description: "AI-powered Discord bot web interface",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
