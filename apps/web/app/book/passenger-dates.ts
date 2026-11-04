// Strict calendar validation; Date.parse alone rolls impossible dates forward.
export function validPassengerDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function passengerDateError(value: string, min = "0001-01-01", max = "9999-12-31"): string {
  if (!value) return "";
  if (!validPassengerDate(value)) return "Enter a valid date with a four-digit year.";
  if (value < min) return `Date must be on or after ${min}.`;
  if (value > max) return `Date must be on or before ${max}.`;
  return "";
}

export function passengerDatesError(p: { dob: string; passportIssueDate: string; passportExpiry: string }, today = localToday()): string {
  for (const [name, value] of [["Date of birth", p.dob], ["Passport issue date", p.passportIssueDate], ["Passport expiry", p.passportExpiry]]) {
    if (value && !validPassengerDate(value)) return `${name}: enter a valid date with a four-digit year.`;
  }
  if (p.dob && p.dob > today) return "Date of birth cannot be in the future.";
  if (p.passportIssueDate && p.passportIssueDate > today) return "Passport issue date cannot be in the future.";
  if (p.passportExpiry && p.passportExpiry <= today) return "Passport expiry must be in the future.";
  if (p.passportIssueDate && p.passportExpiry && p.passportExpiry <= p.passportIssueDate) return "Passport expiry must be later than its issue date.";
  return "";
}

export function passportExpiryMinimum(today = localToday()): string {
  const [year, month, day] = today.split("-").map(Number);
  const next = new Date(0);
  next.setUTCFullYear(year, month - 1, day + 1);
  return next.toISOString().slice(0, 10);
}
