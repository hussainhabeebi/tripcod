import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Personal and payment pages: nothing for search engines there.
      disallow: ["/account", "/admin", "/book", "/checkout", "/pay", "/trips", "/wallet", "/search"],
    },
    sitemap: "https://tripcod.com/sitemap.xml",
  };
}
