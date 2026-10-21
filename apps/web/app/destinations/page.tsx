import type { Metadata } from "next";
import { DestinationGrid } from "../components/TripcodSections";
import { DESTINATIONS } from "../lib/tripcod-content";

export const metadata: Metadata = {
  title: "Destinations — Tripcod Travel Solutions",
  description: "Explore Tripcod's handpicked holiday destinations across Central Asia, Southeast Asia, the Indian Ocean and India.",
};

export default function DestinationsPage() {
  return (
    <main className="tc-page">
      <section className="tc-page-hero">
        <div className="home-shell">
          <div className="section-kicker light">Destinations</div>
          <h1>Popular Destinations</h1>
          <p>Explore our handpicked selection of the most breathtaking locations around the globe</p>
        </div>
      </section>
      <section className="home-shell tc-section">
        <DestinationGrid destinations={DESTINATIONS} />
      </section>
    </main>
  );
}
