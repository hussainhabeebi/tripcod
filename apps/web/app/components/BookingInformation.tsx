import type { ReactNode } from "react";

const benefits = [
  { icon: "⚡", symbol: "fare", title: "Live fare comparison", text: "Compare bookable fares from connected airline suppliers." },
  { icon: "🧳", symbol: "baggage", title: "Baggage made clear", text: "See duration, stops and baggage before choosing." },
  { icon: "📷", symbol: "passport", title: "Scan your passport", text: "Scan your passport to prefill passenger details for review." },
  { icon: "💬", symbol: "updates", title: "WhatsApp updates", text: "Continue your booking and receive ticket updates in chat." },
];

function BenefitSymbol({ symbol }: { symbol: string }) {
  const paths: Record<string, ReactNode> = {
    fare: <><path d="M3 7h18M3 12h12M3 17h9" /><path d="m16 16 2 2 4-5" /></>,
    baggage: <><rect x="4" y="7" width="16" height="14" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M9 11v6m6-6v6" /></>,
    passport: <><rect x="5" y="2" width="14" height="20" rx="2" /><circle cx="12" cy="11" r="3" /><path d="M9 11h6m-3-3v6M9 17h6" /></>,
    updates: <><path d="M20 11.5a8 8 0 0 1-8 8 8.5 8.5 0 0 1-3.5-.8L4 20l1.3-4.5A8 8 0 1 1 20 11.5Z" /><path d="M9 11h6m-6 3h4" /></>,
  };
  return <svg className="benefit-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[symbol]}</svg>;
}

const steps = [
  ["01", "Search", "Tell us your route and travel date."],
  ["02", "Compare", "Choose from the best, cheapest and fastest flights."],
  ["03", "Confirm", "Scan passports or enter passenger details manually."],
  ["04", "Pay & fly", "Pay securely and receive your ticket."],
];

const premiumBenefits = [
  ["01", "Compare with clarity", "See supplier fares, journey times and stops together. Open fare details to check the conditions that matter to you."],
  ["02", "Review before you commit", "Check your itinerary, traveller details and the payable amount before continuing to payment."],
  ["03", "A little human help", "Need a hand with your journey? Our travel team is a WhatsApp message away."],
];

export default function BookingInformation() {
 return <>
      {/* Trust bar */}
      <div className="trust-bar" aria-label="Booking information">
        <div className="trust-item"><span className="trust-item-icon" aria-hidden="true">▣</span> Secure payments</div>
        <div className="trust-item"><span className="trust-item-icon" aria-hidden="true">✓</span> E-ticket delivery</div>
        <div className="trust-item"><span className="trust-item-icon" aria-hidden="true">◉</span> WhatsApp support</div>
        <div className="trust-item"><span className="trust-item-icon" aria-hidden="true">↻</span> Clear cancellation rules</div>
        <div className="trust-item"><span className="trust-item-icon" aria-hidden="true">✈</span> Compare flights</div>
      </div>

      <section className="home-shell benefits-section">
        <div className="section-kicker">Built for easier booking</div>
        <h2 className="home-title">Less form-filling. More confidence.</h2>
        <div className="benefit-grid">
          {benefits.map((item) => (
            <article className="benefit-card" key={item.title}>
              <span className="benefit-icon">{item.icon}</span>
              <span className="benefit-icon-desktop"><BenefitSymbol symbol={item.symbol} /></span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

    <section className="flight-confidence" aria-label="Your booking, made clearer">
      {premiumBenefits.map(([number, title, text]) => <article key={number}><span>{number}</span><h2>{title}</h2><p>{text}</p></article>)}
    </section>

      <section className="journey-section">
        <div className="home-shell">
          <div className="section-kicker light">Simple from search to ticket</div>
          <h2 className="home-title light">Your booking, step by step</h2>
          <div className="journey-grid">
            {steps.map(([number, title, text]) => (
              <article className="journey-card" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

 </>;
}
