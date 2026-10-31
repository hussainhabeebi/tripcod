import type { Metadata } from "next";
import { CONTACT } from "../lib/tripcod-content";
export const metadata: Metadata = { title: "Privacy & data — Tripcod", description: "Understand the information used during your journey." };
export default function InformationPage() {
  return <main className="tc-page"><section className="tc-page-hero"><div className="home-shell"><div className="section-kicker light">Travel information</div><h1>Privacy & data</h1><p>Understand the information used during your journey.</p></div></section>
    <section className="home-shell tc-section"><div className="info-content">
      <section><h2>Information you provide</h2><p>Travel enquiries can include your contact details, route, dates and traveller count. Account and booking screens request information relevant to their purpose, such as contact and passenger details. Review what you are providing before submitting a form or sending a message.</p></section>
      <section><h2>Travel documents</h2><p>Some booking steps offer document scanning to help fill passenger details. You can enter details manually instead. Travel documents contain sensitive personal information; use the intended booking step and avoid adding passport images to a general enquiry.</p></section>
      <section><h2>Service providers and external links</h2><p>Completing a travel booking involves the relevant travel suppliers and payment services. WhatsApp and social links open external services, whose privacy terms apply to activity on those services. Review the information requested and the relevant provider’s terms when using them.</p></section>
      <section><h2>Browser preferences and sign-in</h2><p>The website uses browser storage for features including currency preference and booking access, and a sign-in cookie for account access. Signing out ends the current account session on this browser. Use a private device for passenger and booking information.</p></section>
      <section><h2>Privacy questions and requests</h2><p>Contact Tripcod using the email below to ask about access, correction, deletion, document handling, data sharing or retention for your particular enquiry or booking. State the type of request and a booking reference if relevant; do not email payment credentials. Any verification or applicable booking record requirements can be discussed with the team.</p></section>
      <div className="info-callout"><strong>Questions about your booking or information?</strong><p><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> · <a href="/support">Contact support</a></p></div>
      <p><a href="/terms">Booking terms</a> · <a href="/cancellations">Changes &amp; refunds</a> · <a href="/privacy">Privacy &amp; data</a></p>
    </div></section>
  </main>;
}
