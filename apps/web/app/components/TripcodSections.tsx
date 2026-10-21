import type { ReactNode } from "react";
import {
  bookingLink, GALLERY, HOME_STATS, SERVICES, TESTIMONIALS,
  type Destination, type ServiceIcon,
} from "../lib/tripcod-content";

const SERVICE_ICONS: Record<ServiceIcon, ReactNode> = {
  ticket: <><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Z" /><path d="M14 6v12" strokeDasharray="2 2" /></>,
  visa: <><rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M9 16h6" /></>,
  hotel: <><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M2 21h20M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1" /></>,
  holiday: <><path d="M12 22V10" /><path d="M12 10C12 6 8 3 3 4c2 1 4 3 4 6" /><path d="M12 10c0-4 4-7 9-6-2 1-4 3-4 6" /><path d="M5 22h14" /></>,
  tour: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>,
  attestation: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6" /><path d="m9 15 2 2 4-4" /></>,
  business: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>,
  attraction: <><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18.4 5.6l-2.1 2.1M21 12h-3" /><circle cx="12" cy="13" r="4" /><path d="M8 21h8" /></>,
  bus: <><rect x="4" y="3" width="16" height="15" rx="3" /><path d="M4 11h16M8 18v3m8-3v3M8 14.5h.01M16 14.5h.01" /></>,
  flight: <><path d="m3 21 8-8-6-2-2 2-2-1 3-4 9 1 6-6a2 2 0 0 1 3 3l-6 6 1 9-4 3-1-2 2-2-2-6-8 8Z" /></>,
};

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export function SectionHeading({ kicker, title, intro, light }: { kicker: string; title: string; intro?: string; light?: boolean }) {
  return (
    <div className="tc-heading">
      <div className={light ? "section-kicker light" : "section-kicker"}>{kicker}</div>
      <h2 className={light ? "home-title light" : "home-title"}>{title}</h2>
      {intro && <p className="tc-intro">{intro}</p>}
    </div>
  );
}

export function StatRow({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <dl className="tc-stats">
      {stats.map((s) => (
        <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>
      ))}
    </dl>
  );
}

export function AboutPreview() {
  return (
    <section className="home-shell tc-section" aria-labelledby="tc-about-title">
      <div className="tc-about">
        <div className="tc-about-copy">
          <div className="section-kicker">About our company</div>
          <h2 id="tc-about-title" className="home-title">Our Journey</h2>
          <p className="tc-lead">Discover the story behind Tripcod travel solutions and our passion for creating unforgettable travel experiences.</p>
          <p>Tripcod Travel Solutions was born from a shared passion a desire to help travelers go beyond the guidebooks and into the heart of authentic experiences.</p>
          <p>What began as a small, dedicated team of explorers has grown into a global community of adventurers, each seeking more than just a destination. We curate meaningful journeys that connect you with local cultures, hidden gems, and stories worth telling.</p>
          <p>For us, travel is more than movement it’s transformation. That’s why we craft every trip with care, blending sustainability, accessibility, and deep cultural insight.</p>
          <StatRow stats={HOME_STATS} />
          <a href="/about-us" className="tc-btn tc-btn-dark">Learn More <span aria-hidden="true">→</span></a>
        </div>
        <figure className="tc-about-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gallery/snow-mountain-group.webp" alt="Our team on a mountain trek" loading="lazy" />
        </figure>
      </div>
    </section>
  );
}

export function ServicesSection() {
  return (
    <section className="home-shell tc-section" aria-labelledby="tc-services-title">
      <div className="tc-heading">
        <div className="section-kicker">What we do</div>
        <h2 id="tc-services-title" className="home-title">Our Trusted Services</h2>
        <p className="tc-intro">Explore a wide range of services tailored to make your travel and business needs simple, fast, and reliable.</p>
      </div>
      <div className="tc-services">
        {SERVICES.map((s) => (
          <article key={s.title} className="tc-service">
            <span className="tc-service-icon"><Icon>{SERVICE_ICONS[s.icon]}</Icon></span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DestinationGrid({ destinations }: { destinations: Destination[] }) {
  return (
    <div className="tc-destinations">
      {destinations.map((d) => (
        <article key={d.name} className="tc-destination">
          <div className="tc-destination-top">
            <span className="tc-destination-flag" aria-hidden="true">{d.flag}</span>
            <h3>{d.name}</h3>
          </div>
          <p>{d.text}</p>
          <div className="tc-destination-foot">
            <div className="tc-price"><small>From</small><strong>AED {d.price.toLocaleString("en-US")}</strong></div>
            <a href={bookingLink(d)} target="_blank" rel="noopener" className="tc-btn tc-btn-amber" aria-label={`Book ${d.name} on WhatsApp`}>Book Now</a>
          </div>
        </article>
      ))}
    </div>
  );
}

export function PopularDestinationsSection({ destinations }: { destinations: Destination[] }) {
  return (
    <section className="home-shell tc-section" aria-labelledby="tc-destinations-title">
      <div className="section-heading-row">
        <div>
          <div className="section-kicker">Popular destinations</div>
          <h2 id="tc-destinations-title" className="home-title">Popular Destinations</h2>
          <p className="tc-intro">Explore our handpicked selection of the most breathtaking locations around the globe</p>
        </div>
        <a href="/destinations" className="text-link">View All Destinations →</a>
      </div>
      <DestinationGrid destinations={destinations} />
    </section>
  );
}

export function TestimonialsSection() {
  return (
    <section className="tc-testimonials-band" aria-labelledby="tc-testimonials-title">
      <div className="home-shell tc-section">
        <div className="tc-heading">
          <div className="section-kicker light">Testimonials</div>
          <h2 id="tc-testimonials-title" className="home-title light">What Our Travelers Say</h2>
          <p className="tc-intro light">Hear from real customers who explored the world with TripCod</p>
        </div>
        <div className="tc-testimonials">
          {TESTIMONIALS.map((t) => (
            <figure key={t.author} className="tc-testimonial">
              <blockquote>“{t.quote}”</blockquote>
              <figcaption>— {t.author}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function GallerySection() {
  return (
    <section className="home-shell tc-section" aria-labelledby="tc-gallery-title">
      <div className="tc-heading">
        <div className="section-kicker">Gallery</div>
        <h2 id="tc-gallery-title" className="home-title">Explore Our Travel Moments</h2>
        <p className="tc-intro">A glimpse into the unforgettable journeys, breathtaking views, and memorable experiences captured by our travelers across the globe.</p>
      </div>
      <div className="tc-gallery">
        {GALLERY.map((g) => (
          <figure key={g.src} className="tc-gallery-item">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={g.src} alt={g.alt} loading="lazy" />
            <figcaption>{g.caption}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
