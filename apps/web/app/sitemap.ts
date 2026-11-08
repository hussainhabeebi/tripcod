import type { MetadataRoute } from "next";
import { DESTINATIONS, destinationSlug } from "./lib/tripcod-content";

const SITE_URL = "https://tripcod.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/about-us", "/services", "/insurance", "/travel-check", "/support", "/cancellations", "/privacy", "/terms"];
  return [
    ...pages.map((path) => ({ url: `${SITE_URL}${path}`, changeFrequency: "weekly" as const, priority: path === "" ? 1 : 0.6 })),
    ...DESTINATIONS.map((d) => ({ url: `${SITE_URL}/destinations/${destinationSlug(d)}`, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
