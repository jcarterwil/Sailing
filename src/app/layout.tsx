import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { HelpTooltipProvider } from "@/components/help/help-tooltip-provider";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Sailing",
    template: "%s | Sailing",
  },
  description: "Compare sailboat performance and follow your club racing history.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Sailing",
  },
};

export const viewport: Viewport = {
  themeColor: "#0d1424",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <HelpTooltipProvider>
            <ImpersonationBanner />
            {children}
            <Toaster richColors position="top-center" />
          </HelpTooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
