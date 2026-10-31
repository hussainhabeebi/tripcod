import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DESTINATIONS, bookingLink, destinationSlug } from "../../lib/tripcod-content";

export function generateStaticParams() {
  return DESTINATIONS.map((destination) => ({ slug: destinationSlug(destination) }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const destination = DESTINATIONS.find((item) => destinationSlug(item) === slug);
  return { title: destination ? `${destination.name} Holidays — Tripcod` : "Destination not found — Tripcod", description: destination?.text };
}

export default async function DestinationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const destination = DESTINATIONS.find((item) => destinationSlug(item) === slug);
  if (!destination) notFound();
  const details = [
    ["Dates & duration", "Choose your travel dates and number of nights. Availability is confirmed in your quote."],
    ["Departure & flights", "Tell us your departure city. Ask whether flights, baggage and airport taxes are included."],
    ["Hotel & room", "Request the hotel name, category, room type and occupancy basis."],
    ["Meals & transfers", "Confirm the meal plan, airport transfers, sightseeing and entry tickets included."],
    ["Total & currency", "Request a total for your group, the currency, per-person basis, taxes and exclusions."],
    ["Visa & changes", "Confirm entry requirements for your passport and residence status, plus cancellation conditions."],
  ];
  return <main className="tc-page">
    <section className="tc-page-hero"><div className="home-shell"><div className="section-kicker light">Your next getaway</div><h1>{destination.flag} {destination.name}</h1><p>{destination.text}</p></div></section>
    <section className="home-shell tc-section"><div className="info-content">
      <a href="/destinations" className="text-link">← All destinations</a>
      <h2>A trip shaped around you.</h2>
      <p>Tell us who is travelling, when you want to go and what you would like to experience. This is a destination enquiry, with a tailored itinerary and quote to be agreed before booking.</p>
      <div className="info-callout"><strong>Request a tailored quote</strong><p>There is no fixed package price or set of inclusions on this page. Your written quotation should specify the details below, its validity and the conditions for confirming your trip.</p><a className="tc-btn tc-btn-amber" href={bookingLink(destination)} target="_blank" rel="noopener noreferrer">Enquire on WhatsApp ↗</a></div>
      <h2>What to confirm in your quotation</h2>
      <dl className="package-checklist">{details.map(([title, text]) => <div key={title}><dt>{title}</dt><dd>{text}</dd></div>)}</dl>
      <p>Share your dates, number of adults, children’s ages, departure city, preferred hotel category and budget. Do not send payment details in an enquiry.</p>
      <p><a href="/cancellations">Read about changes and cancellations</a> · <a href="/support">Speak to the team</a></p>
    </div></section>
  </main>;
}
