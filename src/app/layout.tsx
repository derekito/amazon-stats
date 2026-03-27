import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";

import { SiteNav } from "@/components/site-nav";
import { STORE_COOKIE_NAME } from "@/lib/store";

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
  const hasStore = Boolean((await cookies()).get(STORE_COOKIE_NAME)?.value);
  /** Hide nav on the store chooser (`/` with no cookie). */
  const showNav = pathname !== "/login" && !(pathname === "/" && !hasStore);

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
