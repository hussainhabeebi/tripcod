"use client";

import { useEffect, useRef, useState } from "react";

const SLIDES = [
  { image: "/hero/sunset-wing.webp", label: "Sunset above the clouds", caption: "A new perspective awaits." },
  { image: "/hero/airport-sunset.webp", label: "Your next departure", caption: "Every departure is a new beginning." },
  { image: "/hero/global-connections.webp", label: "Connections around the world", caption: "India, the Gulf and wherever comes next." },
];

export default function HeroBanner() {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 6000);
    return () => window.clearInterval(timer);
  }, [playing]);

  function move(delta: number) {
    setIdx((i) => (i + delta + SLIDES.length) % SLIDES.length);
  }

  return <section className="flight-intro" aria-label="Travel inspiration" aria-roledescription="carousel"
    onFocusCapture={(e) => { if (!(e.target as HTMLElement).closest(".flight-slider-play")) setPlaying(false); }} onMouseEnter={() => setPlaying(false)}>
    <div className="flight-intro-copy">
      <p className="flight-eyebrow">TRIPCOD / YOUR NEXT DEPARTURE</p>
      <h1>Good journeys<br />start with <em>better choices.</em></h1>
      <p className="flight-intro-text">Find your flight. Compare the details. Travel your way.<br />India, the Gulf and wherever comes next.</p>
      <div className="flight-intro-note"><span aria-hidden="true">✈</span> One way, return or a journey with more stops.</div>
      <div className="flight-slider-controls" aria-label="Hero slideshow controls">
        <button type="button" onClick={() => move(-1)} aria-label="Previous slide">←</button>
        {SLIDES.map((slide, i) => <button key={slide.image} type="button" className="flight-slide-dot"
          onClick={() => setIdx(i)} aria-label={`Show slide ${i + 1}: ${slide.label}`} aria-pressed={i === idx}>
          <span aria-hidden="true" />
        </button>)}
        <button type="button" onClick={() => move(1)} aria-label="Next slide">→</button>
        <button type="button" className="flight-slider-play" onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? "Pause slideshow" : "Play slideshow"}>{playing ? "Pause" : "Play"}</button>
      </div>
    </div>
    <div className="flight-intro-art" onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const distance = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
        if (Math.abs(distance) > 45) { setPlaying(false); move(distance > 0 ? -1 : 1); }
        touchX.current = null;
      }} onTouchCancel={() => { touchX.current = null; }}>
      {SLIDES.map((slide, i) => <img key={slide.image} src={slide.image} alt="" width="1672" height="941"
        hidden={i !== idx} loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "auto"} />)}
      <span className="flight-art-caption" aria-live={playing ? "off" : "polite"}>{SLIDES[idx].caption}</span>
      <span className="flight-art-mark" aria-hidden="true">T / C</span>
    </div>
  </section>;
}
