import { whatsappLink } from "../lib/tripcod-content";

const shortcuts = [
  { icon: "✈", label: "Flights", note: "Find your route", href: "/#flight-search" },
  { icon: "▤", label: "Hotels", note: "Find your stay", href: "/hotels" },
  { icon: "☀", label: "Holidays", note: "Plan a getaway", href: "/destinations" },
  { icon: "◎", label: "Travel help", note: "Visas & more", href: "/services" },
];

export function TravelShortcuts() {
  return <nav className="home-shell travel-shortcuts" aria-label="Plan your journey">
    {shortcuts.map((item) => <a href={item.href} key={item.label}><span className="shortcut-icon" aria-hidden="true">{item.icon}</span><span><strong>{item.label}</strong><small>{item.note}</small></span><span className="shortcut-arrow" aria-hidden="true">↗</span></a>)}
  </nav>;
}

export function TravelFaq() {
  const faqs = [
    ["Is the price on a route card a live fare?", "Route cards are shortcuts to search. Choose your actual dates and traveller count to see available fares. Check the final total and conditions before payment; availability can change until ticketing."],
    ["What is included in a holiday package?", "Packages are quoted for your dates and group. Ask for a written itinerary stating the number of nights, hotel and room category, meals, flights, transfers, taxes and exclusions before confirming."],
    ["Can I change or cancel a booking?", "This depends on the airline, hotel or package conditions. Fare differences and charges may apply. Send your booking reference to the support team for the conditions and options applicable to your booking."],
    ["Where can I find my ticket?", "Use Find a booking with your PNR or Tripcod booking reference and the email used to book. You can also sign in to My Trips. If a payment was taken but you cannot find a ticket, contact support before paying again."],
  ];
  return <section className="home-shell tc-section travel-faq" aria-labelledby="travel-faq-title">
    <div><div className="section-kicker">A little clarity</div><h2 id="travel-faq-title" className="home-title">Before you set off.</h2><p className="tc-intro">Helpful answers for your next journey.</p><a className="text-link" href="/support">Visit the help centre ↗</a></div>
    <div className="travel-faq-list">{faqs.map(([title, answer]) => <details key={title}><summary>{title}</summary><p>{answer}</p></details>)}</div>
  </section>;
}

export function HelpTopics() {
  const topics = [
    ["Change travel dates", "Include your booking reference and preferred new dates."],
    ["Cancellation & refund", "Ask about eligibility, charges and the status of an existing request."],
    ["Payment or ticket issue", "Share your booking reference and transaction reference. Never share your card number, CVV or OTP."],
    ["Plan a new trip", "Tell us your route, travel dates and number of travellers."],
  ];
  return <div className="help-topic-grid">{topics.map(([title, text]) => <a className="help-topic" key={title} href={whatsappLink(`Hi Tripcod, I need help with: ${title}. My booking reference (if any): `)} target="_blank" rel="noopener noreferrer"><h2>{title} <span aria-hidden="true">↗</span></h2><p>{text}</p><strong>Ask on WhatsApp →</strong></a>)}</div>;
}
