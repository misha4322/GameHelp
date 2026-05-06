import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { getServerSessionSafe } from "@/lib/safe-session";
import { AuthProvider } from "@/app/providers";
import Navbar from "@/app/auth/components/navigation/Navbar";
import Footer from "@/app/auth/components/navigation/Footer";
import WarningsBar from "@/app/auth/components/navigation/WarningsBar";
import PostRevisionBar from "@/app/auth/components/navigation/PostRevisionBar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GameHelp",
  description: "GameHelp — сообщество для обсуждения игр, постов, друзей и сообщений.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSessionSafe();

  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body className={inter.className}>
        <AuthProvider session={session}>
          <div className="app-bg" />
          <Navbar session={session} />
          <WarningsBar />
          <PostRevisionBar />
          <main className="container-page">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}