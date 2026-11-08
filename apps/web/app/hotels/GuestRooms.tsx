"use client";

import { useEffect, useRef, useState } from "react";
import { HOTEL_OCCUPANCY_LIMITS as LIM, occupancyErrors, occupancyTotals, type RoomOccupancy } from "@tripcod/suppliers/hotel-occupancy";

// Room-wise guests for TripJack Hotel API v3: adults and children per room, an
// age for every child (TripJack prices children by age).

const DEFAULT_CHILD_AGE = -1;   // "choose age" — must be picked before searching

export function guestSummary(rooms: RoomOccupancy[]): string {
  const t = occupancyTotals(rooms);
  return [`${t.rooms} room${t.rooms === 1 ? "" : "s"}`, `${t.adults} adult${t.adults === 1 ? "" : "s"}`,
    ...(t.children ? [`${t.children} child${t.children === 1 ? "" : "ren"}`] : [])].join(" · ");
}

function Stepper({ label, hint, value, min, max, onChange, id }: {
  label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void; id: string;
}) {
  return (
    <div className="gr-step">
      <span id={id}><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <div role="group" aria-labelledby={id}>
        <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

export function GuestRooms({ value, onChange }: { value: RoomOccupancy[]; onChange: (rooms: RoomOccupancy[]) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const missingAge = value.some((r) => r.childAges.some((a) => a < 0));
  const problems = missingAge ? ["Choose an age for each child."] : occupancyErrors(value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node) && !missingAge) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !missingAge) setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open, missingAge]);

  const setRoom = (i: number, room: RoomOccupancy) => onChange(value.map((r, n) => n === i ? room : r));
  const setChildren = (i: number, count: number) => {
    const r = value[i];
    const ages = r.childAges.slice(0, count);
    while (ages.length < count) ages.push(DEFAULT_CHILD_AGE);
    setRoom(i, { ...r, childAges: ages });
  };

  return (
    <div className="gr" ref={wrap}>
      <span className="gr-label" id="gr-label">Rooms &amp; guests</span>
      <button type="button" className="gr-toggle" aria-expanded={open} aria-controls="gr-panel" aria-labelledby="gr-label gr-value" onClick={() => setOpen((o) => !o)}>
        <span id="gr-value">{guestSummary(value)}</span><span aria-hidden="true">▾</span>
      </button>
      {/* Hidden input makes the form refuse to submit while a child age is missing. */}
      <input className="gr-guard" tabIndex={-1} aria-hidden="true" value={problems.length ? "" : "ok"} onChange={() => {}} required
        onInvalid={(e) => { (e.target as HTMLInputElement).setCustomValidity(problems[0] ?? ""); setOpen(true); }} />
      {open && (
        <div className="gr-panel" id="gr-panel" role="dialog" aria-label="Rooms and guests">
          {value.map((room, i) => (
            <fieldset key={i} className="gr-room">
              <legend>Room {i + 1}</legend>
              {value.length > 1 && (
                <button type="button" className="gr-remove" onClick={() => onChange(value.filter((_, n) => n !== i))} aria-label={`Remove room ${i + 1}`}>Remove</button>
              )}
              <Stepper id={`gr-a-${i}`} label="Adults" hint="12+ years" value={room.adults} min={LIM.minAdultsPerRoom} max={LIM.maxAdultsPerRoom}
                onChange={(n) => setRoom(i, { ...room, adults: n })} />
              <Stepper id={`gr-c-${i}`} label="Children" hint={`${LIM.minChildAge}–${LIM.maxChildAge} years`} value={room.childAges.length} min={0} max={LIM.maxChildrenPerRoom}
                onChange={(n) => setChildren(i, n)} />
              {room.childAges.length > 0 && (
                <div className="gr-ages">
                  {room.childAges.map((age, c) => (
                    <label key={c}>
                      <span>Child {c + 1} age</span>
                      <select value={age} required aria-invalid={age < 0}
                        onChange={(e) => setRoom(i, { ...room, childAges: room.childAges.map((a, n) => n === c ? Number(e.target.value) : a) })}>
                        <option value={-1} disabled>Age</option>
                        {Array.from({ length: LIM.maxChildAge - LIM.minChildAge + 1 }, (_, k) => k + LIM.minChildAge).map((a) => (
                          <option key={a} value={a}>{a === 0 ? "Under 1" : `${a} yr${a === 1 ? "" : "s"}`}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          ))}
          <div className="gr-foot">
            <button type="button" className="gr-add" disabled={value.length >= LIM.maxRooms}
              onClick={() => onChange([...value, { adults: 1, childAges: [] }])}>+ Add room</button>
            <button type="button" className="gr-done" disabled={problems.length > 0} onClick={() => setOpen(false)}>Done</button>
          </div>
          {problems.length > 0 && <p className="gr-err" role="alert">{problems[0]}</p>}
        </div>
      )}
      <style>{css}</style>
    </div>
  );
}

const css = `
.gr { position: relative; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.gr-label { font-size: 10px; color: #53647a; font-weight: 750; text-transform: uppercase; letter-spacing: .045em; }
.gr-toggle { min-height: 47px; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px;
  border: 1px solid #d8e2ec; border-radius: 9px; background: #fff; color: #172b44; font: inherit; font-size: 13px; cursor: pointer; text-align: left; }
.gr-toggle:focus-visible { outline: none; border-color: #4B4D4F; box-shadow: 0 0 0 3px #4B4D4F1c; }
.gr-guard { position: absolute; bottom: 0; left: 12px; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.gr-panel { position: absolute; top: calc(100% + 6px); right: 0; z-index: 210; width: min(380px, calc(100vw - 32px)); max-height: min(70vh, 560px); overflow-y: auto;
  background: #fff; border: 1px solid #dfe6f0; border-radius: 14px; box-shadow: 0 16px 40px rgba(8,24,49,.18); padding: 14px; }
.gr-room { position: relative; border: 1px solid #edf1f6; border-radius: 12px; padding: 10px 12px 12px; margin: 0 0 10px; }
.gr-room legend { font-size: 12px; font-weight: 800; color: #132944; padding: 0 4px; }
.gr-remove { position: absolute; top: -9px; right: 10px; background: #fff; border: 0; color: #b42318; font-size: 12px; font-weight: 700; cursor: pointer; padding: 2px 4px; }
.gr-step { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; }
.gr-step span { display: flex; flex-direction: column; font-size: 13px; color: #172b44; }
.gr-step small { font-size: 11px; color: #75849b; }
.gr-step div { display: flex; align-items: center; gap: 10px; }
.gr-step button { width: 36px; height: 36px; border-radius: 50%; border: 1px solid #d0d5dd; background: #fff; font-size: 18px; line-height: 1; cursor: pointer; color: #2F3032; }
.gr-step button:disabled { opacity: .35; cursor: not-allowed; }
.gr-step output { min-width: 18px; text-align: center; font-weight: 800; font-size: 14px; }
.gr-ages { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; margin-top: 6px; }
.gr-ages label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #53647a; font-weight: 700; }
.gr-ages select { min-height: 40px; border: 1px solid #d0d5dd; border-radius: 8px; padding: 0 8px; font-size: 13px; background: #fff; color: #172b44; }
.gr-ages select[aria-invalid="true"] { border-color: #f59e0b; background: #fffbeb; }
.gr-foot { display: flex; justify-content: space-between; gap: 10px; margin-top: 4px; }
.gr-add, .gr-done { min-height: 40px; padding: 0 14px; border-radius: 9px; font-weight: 750; font-size: 13px; cursor: pointer; }
.gr-add { border: 1px dashed #98a2b3; background: #fff; color: #2F3032; }
.gr-done { border: 0; background: #4B4D4F; color: #fff; }
.gr-add:disabled, .gr-done:disabled { opacity: .45; cursor: not-allowed; }
.gr-err { margin: 10px 0 0; font-size: 12px; color: #b42318; font-weight: 650; }
@media (max-width: 500px) { .gr-panel { position: fixed; left: 16px; right: 16px; top: auto; bottom: 16px; width: auto; max-height: 75vh; } }
`;
