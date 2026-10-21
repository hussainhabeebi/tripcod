import type { Metadata, Viewport } from "next";
import "./globals.css";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/SiteFooter";

export const metadata: Metadata = {
  title: "Tripcod Travel Solutions",
  description: "Flights, hotels, visas and holiday packages — every destination tells a story. Let yours begin today.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Tripcod" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#4B4D4F",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="site-header">
          <a href="/" className="site-logo-link">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Tripcod Travel Solutions" height={34} className="site-logo" />
          </a>
          <SiteNav />
        </header>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
