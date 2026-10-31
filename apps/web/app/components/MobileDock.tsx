"use client";

import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Explore", path: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></> },
  { href: "/hotels", label: "Stays", path: <><path d="M3 21V4h18v17M1 21h22M9 21v-5h6v5M7 8h2m6 0h2M7 12h2m6 0h2" /></> },
  { href: "/trips/find", label: "My booking", path: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V3h8v4M3 13h18M10 13v3h4v-3" /></> },
  { href: "/support", label: "Help", path: <><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 11H2v7h5v-7H4Zm16 0h2v7h-5v-7h3ZM20 18v3h-8" /></> },
];

export default function MobileDock() {
  const pathname = usePathname();
  // Only the public discovery pages: booking, checkout and account screens retain their existing UI.
  const visible = ["/", "/hotels", "/destinations", "/about-us", "/support", "/services", "/privacy", "/terms", "/cancellations"].includes(pathname) || pathname.startsWith("/destinations/");
  if (!visible) return null;
  return (
    <nav className="mobile-app-dock" aria-label="Quick navigation">
      {items.map((item) => {
        const current = pathname === item.href;
        return <a key={item.href} href={item.href} aria-current={current ? "page" : undefined}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{item.path}</svg>
          <span>{item.label}</span>
        </a>;
      })}
    </nav>
  );
}
