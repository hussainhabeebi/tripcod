"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiCall, readCustomerToken } from "../lib/customer-api";
import { CURRENCY_EVENT, isPrefCurrency, readPrefCurrency, savePrefCurrency, syncAccountCurrency, type PrefCurrency } from "../lib/currency-pref";
import { CURRENCY_LIST } from "../lib/fx";


export default function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [accountName, setAccountName] = useState("");
  // One currency for the whole visit; a signed-in customer's saved choice follows their login.
  const [currency, setCurrency] = useState<PrefCurrency>("INR");
  useEffect(() => {
    const c = readPrefCurrency(); if (c) setCurrency(c);
    const onChange = (e: Event) => { const code = (e as CustomEvent).detail; if (isPrefCurrency(code)) setCurrency(code); };
    window.addEventListener(CURRENCY_EVENT, onChange);
    return () => window.removeEventListener(CURRENCY_EVENT, onChange);
  }, []);
  useEffect(() => {
    const before = readPrefCurrency();
    void syncAccountCurrency().then(() => {
      const after = readPrefCurrency();
      if (after && after !== before && (pathname === "/search" || pathname.startsWith("/search/"))) router.refresh();
    });
  }, [pathname, accountName]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeCurrency(code: PrefCurrency) {
    setCurrency(code);
    savePrefCurrency(code);
    // Server-rendered results read the saved currency: show them again in the new one.
    if (pathname === "/search") router.refresh();
    else if (pathname.startsWith("/search/")) window.location.reload();
  }

  useEffect(() => {
    let cancelled = false;
    async function loadAccountName() {
      const token = readCustomerToken();
      if (!token) { setAccountName(""); return; }
      try {
        const { account } = await apiCall<{ account: { name: string | null } }>("/api/profile/account");
        if (!cancelled && readCustomerToken() === token) setAccountName(account.name?.trim() ?? "");
      } catch {
        if (!cancelled) setAccountName("");
      }
    }
    void loadAccountName();
    window.addEventListener("tripcod:profile-updated", loadAccountName);
    return () => { cancelled = true; window.removeEventListener("tripcod:profile-updated", loadAccountName); };
  }, [pathname]);

  const accountLabel = accountName || "Account";
  const active = pathname === "/" ? "home"
    : pathname === "/search" || pathname.startsWith("/search/") || pathname === "/book" || pathname.startsWith("/book/") || pathname.startsWith("/checkout") ? "flights"
    : pathname.startsWith("/trips") ? "trips"
    : pathname.startsWith("/services") ? "services"
    : pathname.startsWith("/support") ? "support"
    : pathname.startsWith("/destinations") ? "destinations"
    : pathname.startsWith("/about-us") ? "about"
    : pathname.startsWith("/hotels") ? "hotels" : null;

  function navClass(item: string) {
    return active === item ? "nav-link nav-link-active" : "nav-link";
  }

  const accountIcon = (
    <svg className="site-account-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );

  const navItems = [
    { key: "flights", label: "Flights", href: "/#flight-search", icon: <><path d="m3 21 8-8-6-2-2 2-2-1 3-4 9 1 6-6a2 2 0 0 1 3 3l-6 6 1 9-4 3-1-2 2-2-2-6-8 8Z" /></> },
    { key: "trips", label: "My Trips", href: "/trips", icon: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18m-10 0v2h2v-2" /></> },
    { key: "destinations", label: "Destinations", href: "/destinations", icon: <><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></> },
    { key: "hotels", label: "Hotels", href: "/hotels", icon: <><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M2 21h20M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1" /></> },
    { key: "services", label: "Services", href: "/services", icon: <><path d="M4 6h16M4 12h16M4 18h16" /></> },
    { key: "about", label: "About Us", href: "/about-us", icon: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></> },
    { key: "support", label: "Support", href: "/support", icon: <><circle cx="12" cy="12" r="9" /><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01" /></> },
  ];

  const primaryItems = navItems.filter((item) => !["about", "support"].includes(item.key));
  const moreItems = navItems.filter((item) => ["about", "support"].includes(item.key));

  function navigationItems(items = navItems) {
    return items.map(({ key, label, href, icon }) => (
      <a key={key} href={href} className={navClass(key)} aria-current={active === key ? "page" : undefined}>
        <svg className="site-nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
        <span>{label}</span>
      </a>
    ));
  }

  return (
    <nav className="site-nav" aria-label="Main navigation">
      <div className="site-nav-links">{navigationItems(primaryItems)}
        <details className="nav-more"><summary>More <span aria-hidden="true">⌄</span></summary><div>{navigationItems(moreItems)}</div></details>
      </div>
      <label className="nav-currency" title="Prices are shown in this currency on every search">
        <span className="sr-only">Currency</span>
        <select value={currency} onChange={(e) => { if (isPrefCurrency(e.target.value)) changeCurrency(e.target.value); }} aria-label="Currency">
          {CURRENCY_LIST.map((c) => <option key={c.code} value={c.code}>{c.code === "INR" ? "₹ INR" : c.code === "USD" ? "$ USD" : c.code}</option>)}
        </select>
      </label>
      <a href="/account" className="nav-link home-account-link"><span className="site-account-icon-wrap">{accountIcon}</span><span className="site-account-label" title={accountLabel}>{accountLabel}</span></a>
      <details className="home-mobile-menu">
        <summary aria-label="Navigation menu">
          <span className="home-mobile-menu-icon" aria-hidden="true"><i /><i /><i /></span>
          Menu
        </summary>
        <div className="home-mobile-menu-panel">
          {navigationItems(primaryItems)}
          <details className="nav-more"><summary>More <span aria-hidden="true">⌄</span></summary><div>{navigationItems(moreItems)}</div></details>
            <a href="/account" className="nav-link home-menu-account-link"><span className="site-account-icon-wrap">{accountIcon}</span><span className="site-account-label" title={accountLabel}>{accountLabel}</span></a>
        </div>
      </details>
    </nav>
  );
}
