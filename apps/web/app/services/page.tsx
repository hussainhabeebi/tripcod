import type { Metadata } from "next";
import { ServicesSection } from "../components/TripcodSections";
export const metadata: Metadata = { title: "Travel Services — Tripcod", description: "Explore flight ticketing, hotels, holiday planning, visa support and other Tripcod travel services." };
export default function ServicesPage() {
  return <main className="tc-page"><section className="tc-page-hero"><div className="home-shell"><div className="section-kicker light">Plan with Tripcod</div><h1>The details, taken care of.</h1><p>Find the service you need and tell our team about your plans. Availability, eligibility, fees and conditions are confirmed for your enquiry.</p></div></section><ServicesSection /></main>;
}
