import { type DailyHours, type Weekday, WeekdaySchema } from "@pulse/schema";

// Daily hours (an Event's local working hours) against a moment: Right now asks about now, Trips about the trip.

export interface LocalClock {
  day: Weekday;
  minutes: number;
}

// The weekday and minutes since midnight at `at` in the given IANA time zone, summer time included.
// The inverse of `localTime` in the permit Adapter, with the same Intl lookup.
export function localClock(at: Date, timeZone: string): LocalClock {
  const format = { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  const parts = new Intl.DateTimeFormat("en-US", format).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return {
    day: WeekdaySchema.parse(part("weekday").toLowerCase()),
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

// No hours means all day. Hours that end before they start run past midnight; `days` are the days they start on.
export function withinDailyHours({ day, minutes }: LocalClock, hours: DailyHours | undefined): boolean {
  if (!hours) return true;
  const from = minutesOf(hours.from);
  const to = minutesOf(hours.to);
  const startsOn = (d: Weekday) => !hours.days || hours.days.includes(d);
  if (from <= to) return startsOn(day) && minutes >= from && minutes < to;
  return (minutes >= from && startsOn(day)) || (minutes < to && startsOn(previousDay(day)));
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

function previousDay(day: Weekday): Weekday {
  const week = WeekdaySchema.options;
  return week[(week.indexOf(day) + week.length - 1) % week.length]!;
}
