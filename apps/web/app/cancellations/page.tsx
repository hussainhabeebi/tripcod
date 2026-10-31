import type { Metadata } from "next";
import { CONTACT } from "../lib/tripcod-content";
export const metadata: Metadata = { title: "Changes, cancellations & refunds — Tripcod", description: "Find the conditions for your specific booking." };
export default function InformationPage() {
  return <main className="tc-page"><section className="tc-page-hero"><div className="home-shell"><div className="section-kicker light">Travel information</div><h1>Changes, cancellations & refunds</h1><p>Find the conditions for your specific booking.</p></div></section>
    <section className="home-shell tc-section"><div className="info-content">
      <section><h2>Before you book</h2><p>Check whether your selected fare, room or package allows changes or refunds. Conditions differ by supplier and product. Ask for written clarification if the change or cancellation rules are missing from your quotation.</p></section>
      <section><h2>Request a date change or cancellation</h2><p>Contact support with your booking reference, passenger name, current travel date and the change you would like to make. Ask for the applicable charges and any fare difference before confirming the request. Sending an enquiry does not itself change or cancel a reservation.</p></section>
      <section><h2>Refund eligibility and timing</h2><p>Refund eligibility, deductions and processing time depend on the booking conditions, supplier and payment processing. Ask the team for the amount and expected timeline for your specific case; this page does not promise a standard refund period.</p></section>
      <section><h2>Cancelled flight or schedule change</h2><p>Contact the airline and Tripcod to check the options offered for your itinerary. Keep any airline notification and your booking reference available. Do not assume that a replacement booking will be reimbursed without confirmation.</p></section>
      <section><h2>Payment taken but booking unclear</h2><p>Check Find a booking and contact support with the transaction reference. Avoid paying again until the status has been checked. Never share card details, passwords, CVV or OTP codes in chat.</p></section>
      <div className="info-callout"><strong>Questions about your booking or information?</strong><p><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> · <a href="/support">Contact support</a></p></div>
      <p><a href="/terms">Booking terms</a> · <a href="/cancellations">Changes &amp; refunds</a> · <a href="/privacy">Privacy &amp; data</a></p>
    </div></section>
  </main>;
}
