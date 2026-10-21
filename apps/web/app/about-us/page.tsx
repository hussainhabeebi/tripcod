import type { Metadata } from "next";
import { GallerySection, SectionHeading, StatRow } from "../components/TripcodSections";
import { ABOUT_STATS, CORE_VALUES, whatsappLink } from "../lib/tripcod-content";

export const metadata: Metadata = {
  title: "About Us — Tripcod Travel Solutions",
  description: "Founded in 2023, Tripcod Travel Solutions crafts meaningful, personalized journeys that connect travelers with authentic local cultures.",
};

export default function AboutPage() {
  return (
    <main className="tc-page">
      <section className="tc-page-hero">
        <div className="home-shell">
          <div className="section-kicker light">About us</div>
          <h1>Our Journey Began with a Simple Dream</h1>
          <p>Founded in 2023, Tripcod Travel Solutions helps travelers discover untapped destinations and immerse themselves in authentic local cultures.</p>
        </div>
      </section>

      <section className="home-shell tc-section">
        <div className="tc-about">
          <div className="tc-about-copy">
            <p>Founded in 2023, Tripcod Travel Solutions was born out of a shared passion for exploration and a vision to redefine the way people experience the world. What began as a modest initiative by a few travel enthusiasts has blossomed into a trusted global travel brand—helping thousands of adventurers each year discover the beauty of untapped destinations and immerse themselves in authentic local cultures.</p>
            <p>At Tripcod, we don’t just plan trips — we craft meaningful travel experiences. With a deep commitment to sustainability, cultural respect, and personalized journeys, our team works tirelessly to curate unique travel experiences that are both enriching and responsible. From breathtaking landscapes to offbeat cultural encounters, every itinerary is thoughtfully designed to create unforgettable memories.</p>
            <p>Today, our team of 25+ travel experts continues to craft personalized journeys that go beyond typical tourist experiences, connecting our clients with authentic local cultures and hidden gems around the globe.</p>
          </div>
          <figure className="tc-about-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gallery/kuala-lumpur-petronas-towers.webp" alt="Tripcod travelers at the Petronas Towers in Kuala Lumpur" />
            <figcaption className="tc-photo-badge"><strong>1K+</strong> Happy Travelers</figcaption>
          </figure>
        </div>
      </section>

      <section className="home-shell tc-section">
        <SectionHeading kicker="Mission & vision" title="Our Mission & Vision" intro="Driven by passion, guided by purpose" />
        <div className="tc-mission">
          <article>
            <h3>Our Mission</h3>
            <p>To create transformative travel experiences that inspire, educate, and connect people with the world&apos;s diverse cultures, while promoting sustainable and responsible tourism.</p>
          </article>
          <article>
            <h3>Our Vision</h3>
            <p>To be the world&apos;s most trusted travel partner, known for creating meaningful connections between travelers and destinations while preserving the beauty and authenticity of our planet.</p>
          </article>
        </div>
      </section>

      <section className="home-shell tc-section">
        <SectionHeading kicker="Core values" title="Our Core Values" intro="The principles that guide every journey we create" />
        <div className="tc-values">
          {CORE_VALUES.map((v, i) => (
            <article key={v.title} className="tc-value">
              <span className="tc-value-num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{v.title}</h3>
              <p>{v.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-shell tc-section">
        <StatRow stats={ABOUT_STATS} />
      </section>

      <GallerySection />

      <section className="home-shell tc-section">
        <div className="wa-cta">
          <div>
            <div className="section-kicker light">Plan your next trip</div>
            <h2>Let your story begin today</h2>
            <p>Tell us where you want to go and our travel experts will craft a journey made for you.</p>
          </div>
          <a href={whatsappLink("Hi Tripcod, I'd like to plan a trip.")} target="_blank" rel="noopener">Chat on WhatsApp <span>→</span></a>
        </div>
      </section>
    </main>
  );
}
