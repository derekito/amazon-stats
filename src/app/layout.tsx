import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";

import { SiteNav } from "@/components/site-nav";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Amazon Analysis",
  description: "Seller Central sales, FBA inventory, and simple stock forecasts.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const showNav = pathname !== "/login";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {showNav ? <SiteNav /> : null}
        {children}
      </body>
    </html>
  );
}
