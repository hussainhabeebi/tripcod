"use client";

import { useEffect, useId, useRef, useState } from "react";
import { passengerDateError, validPassengerDate } from "./passenger-dates";

// Keep the native calendar and locale-specific date display, with strict manual-entry checks.
export default function PassengerDateInput({ label, value, onChange, required = false, min = "0001-01-01", max = "9999-12-31" }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; min?: string; max?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const help = useId();
  const [entryError, setEntryError] = useState("");
  const error = entryError || passengerDateError(value, min, max);
  useEffect(() => { ref.current?.setCustomValidity(error); }, [error]);
  return <label>{label}
    <input ref={ref} type="date" value={value} required={required} min={min} max={max}
      aria-invalid={!!error} aria-describedby={error ? help : undefined}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        // Native date inputs ignore maxLength; reject expanded years instead of truncating them.
        if (raw && !validPassengerDate(raw)) {
          e.currentTarget.value = "";
          setEntryError("Enter a valid date with a four-digit year.");
          onChange("");
          return;
        }
        setEntryError("");
        onChange(raw);
      }}
      onBlur={(e) => {
        if (e.currentTarget.validity.badInput) setEntryError("Enter a complete, valid date with a four-digit year.");
      }} />
    {error && <span id={help} role="alert" style={{ color: "#b91c1c", fontSize: 12, fontWeight: 400 }}>{error}</span>}
  </label>;
}
