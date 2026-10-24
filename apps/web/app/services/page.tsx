import type { Metadata } from "next";
import { ServicesSection } from "../components/TripcodSections";
import BookingInformation from "../components/BookingInformation";
import { whatsappLink } from "../lib/tripcod-content";

export const metadata: Metadata = { title: "Services — Tripcod Travel Solutions", description: "Explore Tripcod ticketing, visa, hotel, holiday and travel services." };
export default function ServicesPage() {
 return <main className="tc-page restored-home">
  <section className="tc-page-hero"><div className="home-shell"><div className="section-kicker light">Tripcod services</div><h1>Travel made easier.</h1><p>Explore our services and get help planning your next journey.</p></div></section>
  <ServicesSection />
  <BookingInformation />
  <section className="home-shell"><a className="tc-btn tc-btn-amber" href={whatsappLink("Hi Tripcod, I'd like to ask about your services.")} target="_blank" rel="noopener noreferrer">Ask about a service →</a></section>
 </main>;
}
