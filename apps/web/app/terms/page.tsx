import type { Metadata } from "next";
import { CONTACT } from "../lib/tripcod-content";
export const metadata: Metadata = { title: "Booking terms — Tripcod", description: "Understand your booking before confirming." };
export default function InformationPage() {
  return <main className="tc-page"><section className="tc-page-hero"><div className="home-shell"><div className="section-kicker light">Travel information</div><h1>Booking terms</h1><p>Understand your booking before confirming.</p></div></section>
    <section className="home-shell tc-section"><div className="info-content">
      <section><h2>Quotes and availability</h2><p>Search results and quotations are subject to availability. Check the travel dates, route, passengers, currency and final total before payment. A holiday enquiry is a request for a quotation, not a confirmed reservation.</p></section>
      <section><h2>Supplier conditions</h2><p>Airline fares, hotel rates and other travel services have their own baggage, change, cancellation and eligibility conditions. Review the conditions for the specific option you choose. Ask the team to clarify any missing inclusion or charge before proceeding.</p></section>
      <section><h2>Passenger and travel details</h2><p>Check passenger names against travel documents and review dates, airports, baggage and contact details. Entry and transit requirements depend on nationality, residence status and itinerary; confirm applicable requirements with the relevant official authorities before travel.</p></section>
      <section><h2>Confirmation and travel documents</h2><p>Check your booking status and issued documents after booking. Payment confirmation alone should not be treated as an issued airline ticket. If the status is unclear, contact support with your booking and transaction references before trying another payment.</p></section>
      <section><h2>Changes and assistance</h2><p>Request the applicable conditions and charges before asking for a change or cancellation. See the changes and refunds information or contact the team for help with a specific booking.</p></section>
      <div className="info-callout"><strong>Questions about your booking or information?</strong><p><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> · <a href="/support">Contact support</a></p></div>
      <p><a href="/terms">Booking terms</a> · <a href="/cancellations">Changes &amp; refunds</a> · <a href="/privacy">Privacy &amp; data</a></p>
    </div></section>
  </main>;
}
