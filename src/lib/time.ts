export function utcNow(): string {
  return new Date().toISOString();
}

export function isApiWindowOpen(
  expiresAt: string | null,
  now = new Date()
): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiry = new Date(expiresAt);
  return Number.isFinite(expiry.getTime()) && expiry.getTime() > now.getTime();
}

export function apiWindowExpiry(
  inboundAt: Date,
  durationHours = 24
): string {
  return new Date(inboundAt.getTime() + durationHours * 60 * 60 * 1000).toISOString();
}

function zonedMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Unable to resolve operating time for timezone ${timeZone}.`);
  }

  return hour * 60 + minute;
}

function parseClock(value: string): number {
  const [hour, minute] = value.split(":").map(Number);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid clock value: ${value}`);
  }

  return hour * 60 + minute;
}

export function isWithinOperatingHours(
  date: Date,
  timeZone: string,
  operatingHours: string
): boolean {
  const [startText, endText] = operatingHours.split("-");

  if (!startText || !endText) {
    throw new Error(`Invalid operating hours: ${operatingHours}`);
  }

  const current = zonedMinutes(date, timeZone);
  const start = parseClock(startText);
  const end = parseClock(endText);

  return start <= end
    ? current >= start && current < end
    : current >= start || current < end;
}

export function warmupDailyLimit(
  firstAutomationDate: Date,
  currentDate: Date,
  configuredMaximum: number
): number {
  const elapsedDays = Math.max(
    0,
    Math.floor((currentDate.getTime() - firstAutomationDate.getTime()) / 86_400_000)
  );
  const week = Math.floor(elapsedDays / 7);
  return Math.min(configuredMaximum, 5 + week * 5);
}

export function randomDelayMilliseconds(
  minimumSeconds: number,
  maximumSeconds: number,
  random = Math.random
): number {
  const span = maximumSeconds - minimumSeconds + 1;
  return (minimumSeconds + Math.floor(random() * span)) * 1000;
}
