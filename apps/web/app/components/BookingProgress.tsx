export default function BookingProgress({ current }: { current: 1 | 2 | 3 | 4 }) {
  return <nav className="booking-progress" aria-label="Booking progress"><ol>{["Flight selection", "Traveller details", "Booking review", "Payment"].map((label, index) => <li key={label} aria-current={index + 1 === current ? "step" : undefined} data-complete={index + 1 < current}><span aria-hidden="true">{index + 1 < current ? "✓" : index + 1}</span><b>{label}</b></li>)}</ol></nav>;
}
