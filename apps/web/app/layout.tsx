import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./flight-experience.css";
import "./experience.css";
import MobileDock from "./components/MobileDock";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/SiteFooter";

const SITE_URL = "https://tripcod.com";
const DESCRIPTION = "Flights, hotels, visas and holiday packages — every destination tells a story. Let yours begin today.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Tripcod Travel Solutions",
  description: DESCRIPTION,
  applicationName: "Tripcod",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Tripcod" },
  // Google shows the site icon next to search results. It needs a square icon
  // whose size is a multiple of 48px, linked from the home page.
  icons: {
    icon: [
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
      { url: "/favicon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Tripcod Travel Solutions",
    title: "Tripcod Travel Solutions",
    description: DESCRIPTION,
    images: [{ url: "/logo.png", width: 720, height: 252, alt: "Tripcod Travel Solutions" }],
  },
};

// Tells Google the site name and logo (search results and knowledge panel).
const ORGANIZATION_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "TravelAgency",
      "@id": `${SITE_URL}/#organization`,
      name: "Tripcod Travel Solutions",
      alternateName: "Tripcod",
      url: SITE_URL,
      logo: `${SITE_URL}/icon.png`,
      image: `${SITE_URL}/logo.png`,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "Tripcod",
      alternateName: "Tripcod Travel Solutions",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
});

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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ORGANIZATION_JSON_LD }} />
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="site-header">
          <a href="/" className="site-logo-link">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Tripcod Travel Solutions" width={720} height={252} className="site-logo" />
          </a>
          <SiteNav />
        </header>
        <div id="main-content" tabIndex={-1}>{children}</div>
        <SiteFooter />
        <MobileDock />
      </body>
    </html>
  );
}
