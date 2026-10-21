// Tripcod marketing content (from tripcod.com), shared by the home, about and destinations pages.

export const WHATSAPP_NUMBER = "971529319100";

export function whatsappLink(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export const CONTACT = {
  offices: [
    { label: "UAE", address: "Amber Gem Tower, 6th Floor CWS-1V-152239, Sheikh Khalifa Street, Ajman" },
    { label: "India", address: "Tirur Central Junction, Near Okkashi Cafe, Tirur 676101" },
  ],
  phones: [
    { label: "+971 52 931 9100", href: "tel:+971529319100" },
    { label: "+91 9778488122", href: "tel:+919778488122" },
  ],
  email: "tripcodinternational@gmail.com",
};

export const HOME_STATS = [
  { value: "15+", label: "Countries" },
  { value: "1000+", label: "Happy Travelers" },
  { value: "2+", label: "Years Experience" },
];

export const ABOUT_STATS = [
  { value: "1K+", label: "Happy Travelers" },
  { value: "120+", label: "Destinations" },
  { value: "2+", label: "Years Experience" },
  { value: "98%", label: "Satisfaction Rate" },
];

export type ServiceIcon =
  | "ticket" | "visa" | "hotel" | "holiday" | "tour" | "attestation" | "business" | "attraction" | "bus" | "flight";

export const SERVICES: { title: string; text: string; icon: ServiceIcon }[] = [
  { title: "Ticketing", text: "Book flight, train, and event tickets quickly and reliably.", icon: "ticket" },
  { title: "Visa Services", text: "Hassle-free visa application and processing support.", icon: "visa" },
  { title: "Hotel Booking", text: "Find and reserve top-rated hotels at competitive rates.", icon: "hotel" },
  { title: "Holidays", text: "Custom holiday packages for every kind of traveler.", icon: "holiday" },
  { title: "Tours and Transportation", text: "Guided tours and comfortable transport across destinations.", icon: "tour" },
  { title: "Attestation Service", text: "Reliable document attestation for personal and official use.", icon: "attestation" },
  { title: "Business Solutions", text: "Comprehensive services to support and grow your business.", icon: "business" },
  { title: "Attract Tickets", text: "Access tickets to popular attractions and theme parks worldwide.", icon: "attraction" },
  { title: "Visa Change By Bus", text: "Affordable visa change packages via bus for GCC travelers.", icon: "bus" },
  { title: "Visa Change By Flight", text: "Quick and efficient visa change through air travel options.", icon: "flight" },
];

export type Destination = { name: string; text: string; price: number; flag: string };

export const DESTINATIONS: Destination[] = [
  { name: "Baku, Azerbaijan", text: "Explore the rich history, modern architecture, and beautiful landscapes of Azerbaijan.", price: 750, flag: "🇦🇿" },
  { name: "Tbilisi, Georgia", text: "Discover stunning mountain ranges, ancient monasteries, and vibrant culture in Georgia.", price: 900, flag: "🇬🇪" },
  { name: "Armenia", text: "Experience the unique heritage, delicious cuisine, and scenic beauty of Armenia.", price: 800, flag: "🇦🇲" },
  { name: "Kazakhstan", text: "Enjoy vast steppes, modern cities, and nomadic traditions in Kazakhstan.", price: 1000, flag: "🇰🇿" },
  { name: "Kyrgyzstan", text: "Explore breathtaking mountain landscapes and nomadic culture in Kyrgyzstan.", price: 1000, flag: "🇰🇬" },
  { name: "Uzbekistan", text: "Visit ancient Silk Road cities and rich Islamic architecture in Uzbekistan.", price: 1000, flag: "🇺🇿" },
  { name: "Thailand", text: "Relax on tropical beaches, explore vibrant markets, and enjoy Thai cuisine.", price: 800, flag: "🇹🇭" },
  { name: "Vietnam", text: "Discover stunning landscapes, historic sites, and delicious street food in Vietnam.", price: 800, flag: "🇻🇳" },
  { name: "Malaysia", text: "Experience diverse culture, modern cities, and tropical islands in Malaysia.", price: 800, flag: "🇲🇾" },
  { name: "Indonesia", text: "Enjoy paradise beaches, vibrant nightlife, and rich cultural heritage in Bali.", price: 1000, flag: "🇮🇩" },
  { name: "Sri Lanka", text: "Explore ancient temples, wildlife parks, and pristine beaches in Sri Lanka.", price: 1000, flag: "🇱🇰" },
  { name: "Maldives", text: "Relax in luxurious overwater villas and crystal-clear waters in the Maldives.", price: 1000, flag: "🇲🇻" },
  { name: "Kashmir", text: "Experience breathtaking valleys, serene lakes, and stunning mountain views.", price: 700, flag: "🇮🇳" },
  { name: "Delhi", text: "Discover rich history, vibrant bazaars, and delicious street food in Delhi.", price: 500, flag: "🇮🇳" },
  { name: "Manali", text: "Enjoy cool mountain air, adventure sports, and beautiful landscapes in Manali.", price: 600, flag: "🇮🇳" },
];

/** The six destinations featured on the home page. */
export const POPULAR_DESTINATIONS = DESTINATIONS.slice(0, 6);

export function bookingLink(d: Destination): string {
  return whatsappLink(`Hi, I'm interested in booking a trip to ${d.name} for AED ${d.price}. Please share more details.`);
}

export const TESTIMONIALS = [
  { quote: "TripCod planned our honeymoon to Bali and it was absolutely magical. From the private beach villa to the curated experiences, every detail was spot on. We just showed up and enjoyed the ride.", author: "Aisha & Rahul, Mumbai" },
  { quote: "As a solo traveler, I was nervous at first, but TripCod’s support team made me feel safe and confident. I explored Vietnam like a local — couldn’t have asked for more!", author: "Priya D., Bengaluru" },
  { quote: "We booked a family Europe tour with TripCod and every member — from kids to grandparents — loved it! The itinerary was well-paced, accommodations were top-notch, and the memories? Priceless.", author: "The Sharma Family, Delhi" },
  { quote: "TripCod made our corporate retreat to Dubai seamless. Great venues, smooth transfers, and everything on schedule — highly professional!", author: "Rajiv Menon, Chennai" },
  { quote: "My kids loved the Singapore holiday — Universal Studios, Sentosa, and the zoo! Thank you TripCod for planning a trip we’ll always remember.", author: "Meenakshi Rao, Hyderabad" },
  { quote: "Thanks to TripCod, our Kashmir getaway was pure bliss — smooth bookings, friendly guides, and picture-perfect snow everywhere!", author: "Irfan & Sana, Kochi" },
];

export const GALLERY = [
  { src: "/gallery/sir-baniyas-cruise.webp", caption: "Sir Baniyas Cruise", alt: "Family in front of a cruise ship on the Sir Baniyas cruise" },
  { src: "/gallery/dubai-tour.webp", caption: "Dubai Tour", alt: "Family selfie during a Dubai tour" },
  { src: "/gallery/kuala-lumpur-petronas-towers.webp", caption: "Kuala Lumpur, Malaysia", alt: "Group of travelers at the Petronas Towers at night" },
  { src: "/gallery/baku-trip.webp", caption: "Baku Trip", alt: "Family in the snow on a Baku trip" },
  { src: "/gallery/snow-mountain-group.webp", caption: "Mountain Adventure", alt: "Group of travelers on a snowy mountain" },
];

export const CORE_VALUES = [
  { title: "Passion for Travel", text: "We live and breathe travel. Our genuine enthusiasm for exploration drives us to discover and share the world's most incredible experiences." },
  { title: "Trust & Safety", text: "Your safety and peace of mind are our top priorities. We maintain the highest standards and work only with trusted partners worldwide." },
  { title: "Personal Service", text: "Every traveler is unique. We take time to understand your dreams and craft personalized experiences that exceed expectations." },
  { title: "Sustainable Tourism", text: "We're committed to protecting the destinations we love through responsible travel practices and supporting local communities." },
  { title: "Excellence", text: "We strive for perfection in every detail, from initial planning to your safe return home, ensuring memories that last a lifetime." },
  { title: "Innovation", text: "We continuously evolve and embrace new technologies and ideas to enhance your travel experience and discover new possibilities." },
];
