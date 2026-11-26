import type { useTranslation } from "react-i18next";
import type { Pin } from "./events.ts";

// Words for a row's right side: a crowd's time on a Trip, and how far.

type T = ReturnType<typeof useTranslation>["t"];

// "starts 19:00", "ends about 21:30".
export function crowdText({ at, time }: NonNullable<NonNullable<Pin["trip"]>["crowd"]>, timeZone: string, t: T): string {
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(time));
  return t(at === "start" ? "crowdStart" : "crowdEnd", { time: clock });
}

// "110 m" to the nearest ten metres, "2.2 km" from a kilometre.
export function distance(m: number, language: string): string {
  return m < 1000
    ? new Intl.NumberFormat(language, { style: "unit", unit: "meter" }).format(Math.round(m / 10) * 10)
    : new Intl.NumberFormat(language, { style: "unit", unit: "kilometer", maximumFractionDigits: 1 }).format(m / 1000);
}
