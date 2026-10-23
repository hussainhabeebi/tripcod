import SearchWidget from "./components/SearchWidget";
import { whatsappLink } from "./lib/tripcod-content";

const benefits = [
  ["01", "Compare with clarity", "See supplier fares, journey times and stops together. Open fare details to check the conditions that matter to you."],
  ["02", "Review before you commit", "Check your itinerary, traveller details and the payable amount before continuing to payment."],
  ["03", "A little human help", "Need a hand with your journey? Our travel team is a WhatsApp message away."],
];
export default function HomePage() {
  return <main className="flight-home">
    <section className="flight-intro">
      <div className="flight-intro-copy">
        <p className="flight-eyebrow">TRIPCOD / YOUR NEXT DEPARTURE</p>
        <h1>Good journeys<br />start with <em>better choices.</em></h1>
        <p className="flight-intro-text">Find your flight. Compare the details. Travel your way.<br />India, the Gulf and wherever comes next.</p>
        <div className="flight-intro-note"><span aria-hidden="true">✈</span> One way, return or a journey with more stops.</div>
      </div>
      <div className="flight-intro-art" aria-hidden="true">
        <img src="/hero/airplane-wing-clouds.webp" alt="" width="900" height="600" fetchPriority="high" />
        <span className="flight-art-caption">A new perspective awaits.</span>
        <span className="flight-art-mark">T / C</span>
      </div>
    </section>
    <section id="flight-search" className="flight-search-shell" aria-labelledby="flight-search-heading">
      <div className="flight-search-title"><div><p className="flight-eyebrow">LET’S GET YOU THERE</p><h2 id="flight-search-heading">Where are you flying?</h2></div><span>Search · Compare · Book</span></div>
      <SearchWidget />
    </section>
    <section className="flight-confidence" aria-label="Your booking, made clearer">
      {benefits.map(([number, title, text]) => <article key={number}><span>{number}</span><h2>{title}</h2><p>{text}</p></article>)}
    </section>
    <section className="flight-manage">
      <div><p className="flight-eyebrow">YOUR JOURNEY, IN ONE PLACE</p><h2>Already have a booking?</h2><p>Check its status, view your itinerary and find available travel documents.</p></div>
      <div className="flight-manage-actions"><a className="flight-primary" href="/trips">My Trips <span aria-hidden="true">↗</span></a><a href="/trips/find">Find a guest booking →</a></div>
    </section>
    <section className="flight-assistance" id="booking-support"><div><p className="flight-eyebrow">A REAL PERSON, WHEN YOU NEED ONE</p><h2>Let’s make your next<br />departure a little easier.</h2><p>Ask our team about routes, booking details or your next trip.</p></div><a className="flight-primary" href={whatsappLink("Hi Tripcod, I need help with a flight booking.")} target="_blank" rel="noopener noreferrer">Talk to Tripcod ↗</a></section>
  </main>;
}
