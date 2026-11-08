import { CONTACT } from "../lib/tripcod-content";

const PORTAL_URL = (process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.tripcod.com").replace(/\/+$/, "");

const columns = [
  {
    title: "Book",
    links: [
      { label: "Flights", href: "/" },
      { label: "Hotels", href: "/hotels" },
      { label: "Baggage & visa check", href: "/travel-check" },
    ],
  },
  {
    title: "Manage",
    links: [
      { label: "My Trips", href: "/trips" },
      { label: "Find a booking", href: "/trips/find" },
      { label: "My account", href: "/account" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about-us" },
      { label: "Services", href: "/services" },
      { label: "Support", href: "/support" },
      { label: "Destinations", href: "/destinations" },
    ],
  },
  {
    title: "For agents",
    links: [
      { label: "Register your agency", href: `${PORTAL_URL}/register` },
      { label: "Agent login", href: `${PORTAL_URL}/login` },
    ],
  },
];

const socials = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/tripcod_",
    icon: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" /></>,
  },
  {
    label: "Facebook",
    href: "https://www.facebook.com/share/16HLRp3aWu/",
    icon: <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8Z" />,
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@tripcod",
    icon: <><rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="m10 9.5 5 2.5-5 2.5v-5Z" fill="currentColor" /></>,
  },
];

const perks = ["Agent-only fares", "Commission on every booking", "Sub-agents & staff logins", "Wallet & credit limits"];

export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <section className="footer-agent-cta" aria-labelledby="footer-agent-title">
          <div className="footer-agent-copy">
            <span className="footer-agent-kicker">Tripcod for Agents</span>
            <h2 id="footer-agent-title">Run your travel agency on Tripcod</h2>
            <ul className="footer-agent-perks">
              {perks.map((perk) => (
                <li key={perk}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                  {perk}
                </li>
              ))}
            </ul>
          </div>
          <div className="footer-agent-actions">
            <a href={`${PORTAL_URL}/register`} className="footer-btn footer-btn-primary">
              Register as an agent
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </a>
            <a href={`${PORTAL_URL}/login`} className="footer-btn footer-btn-ghost">Agent login</a>
          </div>
        </section>

        <div className="footer-main">
          <div className="footer-brand">
            <a href="/" className="footer-logo-link">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-light.png" alt="Tripcod Travel Solutions" width={720} height={252} />
            </a>
            <p>Making your travel dreams come true since 2023. Flights, hotels, visas and holiday packages — India, the Gulf and beyond.</p>
            <div className="footer-trust">
              <span>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                Secure payments
              </span>
              <span>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>
                Ticket status updates
              </span>
            </div>
            <ul className="footer-social" aria-label="Follow Tripcod">
              {socials.map((social) => (
                <li key={social.label}>
                  <a href={social.href} target="_blank" rel="noopener" aria-label={social.label}>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{social.icon}</svg>
                  </a>
                </li>
              ))}
            </ul>
            <address className="footer-contact">
              {CONTACT.offices.map((o) => (
                <p key={o.label}><strong>{o.label}:</strong> {o.address}</p>
              ))}
              <p>
                {CONTACT.phones.map((ph, i) => (
                  <span key={ph.href}>{i > 0 && " · "}<a href={ph.href}>{ph.label}</a></span>
                ))}
              </p>
              <p><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></p>
            </address>
          </div>

          <nav className="footer-columns" aria-label="Footer">
            {columns.map((column) => (
              <div key={column.title} className="footer-column">
                <h3>{column.title}</h3>
                <ul>
                  {column.links.map((link) => (
                    <li key={link.label}><a href={link.href}>{link.label}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <nav className="footer-policy-links" aria-label="Travel information and policies">
          <a href="/terms">Booking terms</a>
          <a href="/cancellations">Changes, cancellations & refunds</a>
          <a href="/privacy">Privacy & data</a>
          <a href="/support">Contact support</a>
        </nav>
        <div className="footer-bottom">
          <span>© {year} Tripcod. All rights reserved.</span>
          <span className="footer-bottom-note">Fares are subject to availability until ticketed.</span>
          <span className="footer-credits">
            <span>Built by team <a href="https://aiingo.com" target="_blank" rel="noopener">aiingo.com</a></span>
            <span aria-hidden="true">·</span>
            <span>Powered by <a href="https://leadvyne.com" target="_blank" rel="noopener">leadvyne.com</a></span>
          </span>
        </div>
      </div>
    </footer>
  );
}
