import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { LanguageProvider } from "@/lib/i18n";
import PwaRegister from "@/components/pwa/PwaRegister";
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
  title: "Trans Jit ERP",
  description: "Transjit Software — Transit Express ERP",
  applicationName: "Trans Jit ERP",
  appleWebApp: {
    capable: true,
    title: "Trans Jit ERP",
    statusBarStyle: "default",
  },
  themeColor: "#0B3A67",
};

/** Prevent year-long CDN/static HTML caching of app shell pages (e.g. /login).
 * Hashed `/_next/static/*` assets remain cacheable; only document rendering is dynamic. */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <LanguageProvider>
            <PwaRegister />
            {children}
            <Toaster />
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
