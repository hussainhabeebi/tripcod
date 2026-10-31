import type { Metadata } from "next";
import { HelpTopics, TravelFaq } from "../components/TravelExperience";
import { CONTACT } from "../lib/tripcod-content";

export const metadata: Metadata = { title: "Help & Support — Tripcod", description: "Contact Tripcod about a booking, date change, refund, ticket issue or your next trip." };
export default function SupportPage() {
  return <main className="tc-page">
    <section className="tc-page-hero"><div className="home-shell"><div className="section-kicker light">Here to help</div><h1>Let’s get your journey sorted.</h1><p>Choose a topic so your enquiry starts with the right details.</p></div></section>
    <section className="home-shell tc-section"><HelpTopics /></section>
    <section className="home-shell tc-section"><div className="info-content">
      <h2>Travelling soon?</h2><p>Call our team for a time-sensitive enquiry. If you are at the airport or departure is imminent, also contact the airline directly. Response and resolution times depend on the request and supplier.</p>
      <p>{CONTACT.phones.map((phone) => <span key={phone.href}><a className="tc-btn tc-btn-dark" href={phone.href}>{phone.label}</a>{" "}</span>)}</p>
      <p>Email: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></p>
      <h2>Already have a booking?</h2><p><a href="/trips/find">Find your booking using your reference and email</a>, or <a href="/trips">sign in to My Trips</a>.</p>
      <div className="info-callout"><strong>Charged but no ticket?</strong><p>Check your booking status and contact the team with your transaction reference before attempting another payment. Payment confirmation and ticket issuance are separate stages.</p></div>
      <h2>Our offices</h2>{CONTACT.offices.map((office) => <p key={office.label}><strong>{office.label}</strong><br />{office.address}</p>)}
    </div></section>
    <TravelFaq />
  </main>;
}
