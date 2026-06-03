import { RootProvider } from "fumadocs-ui/provider/next";
import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./global.css";

const geist_sans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geist_mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: {
    default: "svelte-effect-runtime",
    template: "%s | svelte-effect-runtime",
  },
  description: "Effect-native runtime helpers for Svelte and SvelteKit.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const class_name = [
    "flex min-h-screen flex-col",
    geist_sans.variable,
    geist_mono.variable,
  ].join(" ");

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={class_name}>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
