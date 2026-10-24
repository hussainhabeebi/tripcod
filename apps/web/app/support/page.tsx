import type { Metadata } from "next";
import { CONTACT, whatsappLink } from "../lib/tripcod-content";
export const metadata: Metadata = { title: "Support — Tripcod Travel Solutions", description: "Contact Tripcod for help with routes, bookings and travel details." };
export default function SupportPage() {
 return <main className="tc-page">
  <section className="tc-page-hero"><div className="home-shell"><div className="section-kicker light">Customer support</div><h1>How can we help?</h1><p>Get help with your journey, booking details or next trip.</p></div></section>
      <section className="home-shell">
        <div className="wa-cta">
          <div>
            <div className="section-kicker light">Need help choosing?</div>
            <h2>Continue with our travel assistant</h2>
            <p>Share your route on WhatsApp and move directly from flight selection to secure checkout.</p>
          </div>
          <a href={whatsappLink("Hi Tripcod, I need help planning a trip.")} target="_blank" rel="noopener" aria-label="Continue on WhatsApp">Continue on WhatsApp <span>→</span></a>
        </div>
      </section>

    <section className="flight-assistance" id="booking-support"><div><p className="flight-eyebrow">A REAL PERSON, WHEN YOU NEED ONE</p><h2>Let’s make your next<br />departure a little easier.</h2><p>Ask our team about routes, booking details or your next trip.</p></div><a className="flight-primary" href={whatsappLink("Hi Tripcod, I need help with a flight booking.")} target="_blank" rel="noopener noreferrer">Talk to Tripcod ↗</a></section>

      {/* Floating WhatsApp */}
      <a href={whatsappLink("Hi Tripcod, I need help planning a trip.")} target="_blank" rel="noopener" className="wa-float" aria-label="Chat on WhatsApp">
        <span className="wa-float-icon">💬</span>
        <span className="wa-float-label">Need help?</span>
      </a>
  <section className="home-shell"><h2>Contact Tripcod</h2><p>{CONTACT.phones.map(phone => <a className="tc-btn tc-btn-dark" key={phone.href} href={phone.href}>{phone.label}</a>)}</p><p><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></p><p><a href="/trips">My Trips →</a> · <a href="/trips/find">Find a guest booking →</a></p></section>
 </main>;
}
