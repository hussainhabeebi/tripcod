import SearchWidget from "./components/SearchWidget";
import HeroBanner from "./components/HeroBanner";
import PopularRoutes from "./components/PopularRoutes";
import { PopularDestinationsSection } from "./components/TripcodSections";
import { POPULAR_DESTINATIONS } from "./lib/tripcod-content";

const DEAL_ROUTES = [
  { from: "COK", to: "DXB", label: "Kochi → Dubai",       price: "₹9,499", note: "From Oct 2026" },
  { from: "CCJ", to: "DXB", label: "Kozhikode → Dubai",   price: "₹8,999", note: "From Oct 2026" },
  { from: "DEL", to: "DXB", label: "Delhi → Dubai",       price: "₹10,299", note: "From Oct 2026" },
  { from: "BOM", to: "DXB", label: "Mumbai → Dubai",      price: "₹11,499", note: "From Oct 2026" },
  { from: "COK", to: "DOH", label: "Kochi → Doha",        price: "₹8,799", note: "From Oct 2026" },
  { from: "BLR", to: "SIN", label: "Bangalore → Singapore", price: "₹13,999", note: "From Oct 2026" },
];

const AIRLINE_LOGOS = [
  { code: "AI", name: "Air India",       icon: "🇮🇳" },
  { code: "EK", name: "Emirates",        icon: "🇦🇪" },
  { code: "QR", name: "Qatar Airways",   icon: "🇶🇦" },
  { code: "EY", name: "Etihad",          icon: "🇦🇪" },
  { code: "6E", name: "IndiGo",          icon: "✈" },
  { code: "SG", name: "SpiceJet",        icon: "🌶" },
  { code: "G8", name: "Go First",        icon: "✈" },
  { code: "UK", name: "Vistara",         icon: "✈" },
];

export default function HomePage() {
  return <main className="flight-home restored-home">
    <HeroBanner />
    <section id="flight-search" className="flight-search-shell" aria-labelledby="flight-search-heading">
      <div className="flight-search-title"><div><p className="flight-eyebrow">LET’S GET YOU THERE</p><h2 id="flight-search-heading">Where are you flying?</h2></div><span>Search · Compare · Book</span></div>
      <SearchWidget />
    </section>

    <section className="flight-manage">
      <div><p className="flight-eyebrow">YOUR JOURNEY, IN ONE PLACE</p><h2>Already have a booking?</h2><p>Check its status, view your itinerary and find available travel documents.</p></div>
      <div className="flight-manage-actions"><a className="flight-primary" href="/trips">My Trips <span aria-hidden="true">↗</span></a><a href="/trips/find">Find a guest booking →</a></div>
    </section>
      {/* Deals section */}
      <section className="home-shell deal-cards-section" style={{ paddingTop: 48 }}>
        <div className="section-heading-row">
          <div>
            <div className="section-kicker">Route inspiration</div>
            <h2 className="home-title">Explore flight routes</h2>
          </div>
          <a href="#flight-search" className="text-link">Search all routes →</a>
        </div>
        <p className="tc-intro">Original sample fares below are illustrative, not live quotes. Search to confirm current availability and price.</p>
        <div className="deal-cards-grid">
          {DEAL_ROUTES.map((r) => (
            <a
              key={`${r.from}-${r.to}`}
              href={`/search?origin=${r.from}&destination=${r.to}&departureDate=${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}&adults=1&cabinClass=ECONOMY&tripType=ONEWAY`}
              className="deal-card"
            >
              <div className="deal-card-route">{r.label}</div>
              <div className="deal-card-price">{r.price}</div>
              <div className="deal-card-note">{r.note}</div>
            </a>
          ))}
        </div>
      </section>

      <section className="home-shell popular-routes-section">
        <div className="section-heading-row">
          <div>
            <div className="section-kicker">Popular now</div>
            <h2 className="home-title">Routes travellers are checking</h2>
          </div>
        </div>
        <p className="tc-intro">Displayed starting fares are original examples. Live fares are confirmed in search.</p>
        <PopularRoutes routes={[]} />
        <a href="#flight-search" className="text-link">Custom search →</a>
      </section>

    <PopularDestinationsSection destinations={POPULAR_DESTINATIONS} />
      {/* Airline partners */}
      <section className="home-shell airline-logos-section" style={{ paddingTop: 0 }}>
        <div className="section-kicker">Airline directory</div>
        <h2 className="home-title">Explore airline options</h2>
        <p className="tc-intro">Names from our original website directory. Current airline availability is shown only in flight search.</p>
        <div className="airline-logos-grid">
          {AIRLINE_LOGOS.map((a) => (
            <div key={a.code} className="airline-logo-chip">
              <span className="airline-logo-icon">{a.icon}</span>
              {a.name}
            </div>
          ))}
        </div>
      </section>

  </main>;
}
