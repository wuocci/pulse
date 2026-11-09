// PROTOTYPE — throwaway. Three Event card variants on the Home route, chosen with ?variant=A|B|C.
// Question: what should the card look like (agreed 2026-11-09: table card, plain title + address, Severity pill,
// rows only when known, fi-FI numeric dates). Lives on branch prototype/event-card only; never merge.
import type { Event, Schema } from "@pulse/client";
import { Ban, BusFront, Circle, CircleOff, Clock, ExternalLink, MapPin, Plane, Siren, Users, Volume2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { textIn, toneOf } from "./events.ts";
import { TONE_CLASSES, WHO_ICONS } from "./map/EventPin.tsx";

export const CARD_VARIANTS = ["A", "B", "C"] as const;
export const CARD_VARIANT_NAMES: Record<(typeof CARD_VARIANTS)[number], string> = { A: "Table", B: "Verdict first", C: "Tiles" };

interface Props {
  event: Event;
  languages: readonly string[];
  timeZone: string;
  onClose: () => void;
}

// ---------- shared helpers (prototype-grade) ----------

const WORK_TITLE: Record<Schema<"WorkType">, string> = {
  water_sewer: "Water pipe dig",
  district_heating: "District heating dig",
  electricity_telecom: "Cable dig",
  paving: "Resurfacing",
  street_construction: "Street construction",
  building_site: "Building site",
  other: "Street dig",
};

// "Water pipe dig" + "Messitytönkatu 2": from the work type when known, else the Source title's two halves.
function plainTitle(event: Event, languages: readonly string[]) {
  const source = textIn(event.title, languages);
  const [head, ...rest] = source.split(" · ");
  const address = rest.join(" · ") || undefined;
  if (event.workType) return { title: WORK_TITLE[event.workType], address: address ?? head };
  return { title: head ?? source, address };
}

const SEVERITY: Record<Event["severity"], { label: string; cls: string }> = {
  info: { label: "For information", cls: "bg-muted text-muted-foreground" },
  minor: { label: "Minor", cls: "bg-muted text-muted-foreground" },
  consider: { label: "Some disruption", cls: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" },
  major: { label: "Major disruption", cls: "bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100" },
};

const WHO: Record<Schema<"MainlyAffected">, string | undefined> = {
  drivers: "Drivers",
  pedestrians: "Pedestrians",
  cyclists: "Cyclists",
  transit: "Public transport",
  parking: "Parking",
  everyone: "Everyone",
  nobody: undefined,
  unknown: undefined,
};

const HOW: Record<Schema<"Noticeable">, { label: string; Icon: typeof Ban }> = {
  noise: { label: "Noise", Icon: Volume2 },
  crowd: { label: "Crowds", Icon: Users },
  sirens: { label: "Sirens", Icon: Siren },
  blocked: { label: "Blocked way", Icon: Ban },
  aircraft: { label: "Low aircraft", Icon: Plane },
  outage: { label: "Out of service", Icon: CircleOff },
};

const DAYS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

// fi-FI numbers, always the year, "Today" for today, times as 18.00: "Now – 31.12.2027", "Today 18.00–21.30".
function whenFi({ when, status }: Event, timeZone: string, now = new Date()) {
  const date = new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "numeric", year: "numeric", timeZone });
  const time = new Intl.DateTimeFormat("fi-FI", { hour: "numeric", minute: "2-digit", timeZone });
  const start = new Date(when.start);
  const end = when.end ? new Date(when.end) : undefined;
  const today = date.format(now);
  const sameDay = end && date.format(start) === date.format(end);
  const midnight = (d: Date) => time.format(d) === "0.00";
  const at = (d: Date) => (midnight(d) ? date.format(d) : `${date.format(d)} ${time.format(d)}`);

  let main: string;
  if (status === "resolved") main = `Ended ${end ? date.format(end) : ""}`.trim();
  else if (sameDay && end) {
    const day = date.format(start) === today ? "Today" : date.format(start);
    main = `${day} ${time.format(start)}–${time.format(end)}`;
  } else if (start <= now) main = end ? `Now – ${date.format(end)}` : "Now, no end date";
  else main = end ? `${at(start)} – ${at(end)}` : `From ${at(start)}`;

  const d = when.dailyHours;
  const hours = d && !sameDay
    ? `${!d.days ? "daily" : d.days.length === 5 && !d.days.some((x) => x === "sat" || x === "sun") ? "weekdays" : d.days.map((x) => DAYS[x] ?? x).join(", ")} ${d.from.replace(":", ".")}–${d.to.replace(":", ".")}`
    : undefined;
  return { main, hours };
}

function list(names: string[]) {
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(names);
}

function facts(event: Event, timeZone: string) {
  const when = whenFi(event, timeZone);
  const who = WHO[event.mainlyAffected];
  return {
    when,
    who,
    how: event.noticeable.map((n) => HOW[n]),
    lines: event.where.lineNames?.length ? list(event.where.lineNames) : undefined,
    stops: event.where.stopNames?.length ? list(event.where.stopNames) : undefined,
    vague: event.where.precision === "vague",
  };
}

function Pill({ severity }: { severity: Event["severity"] }) {
  const s = SEVERITY[severity];
  return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

function Close({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="icon" className="-mt-1 -mr-2 size-10 shrink-0" aria-label="Close" onClick={onClose}>
      <X aria-hidden />
    </Button>
  );
}

// Source and the original text, behind More.
function Footer({ event, languages }: { event: Event; languages: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const source = event.sources[0];
  const original = textIn(event.title, languages);
  return (
    <div className="space-y-2 border-t pt-2 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        {source?.url ? (
          <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
            {source.name} <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : (
          <span>{source?.name}</span>
        )}
        <button type="button" className="font-medium hover:text-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Less ▴" : "More ▾"}
        </button>
      </div>
      {open && (
        <div className="max-h-[30dvh] space-y-2 overflow-y-auto">
          <p className="font-medium text-foreground">{original}</p>
          {event.originalText && <p className="whitespace-pre-line">{textIn(event.originalText, languages)}</p>}
          <p>
            {event.sources.map((s) => `${s.name} · ${s.license}`).join("; ")}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- A: Table ----------
// Title + address and the pill on top, then a two-column table: label left, value right.
function VariantA({ event, languages, timeZone, onClose }: Props) {
  const { title, address } = plainTitle(event, languages);
  const f = facts(event, timeZone);
  const rows: [string, string][] = [
    ["When", f.when.hours ? `${f.when.main} · ${f.when.hours}` : f.when.main],
    ...(f.who ? ([["Affects", f.who]] as [string, string][]) : []),
    ...(f.how.length ? ([["You'd see", f.how.map((h) => h.label).join(" · ")]] as [string, string][]) : []),
    ...(f.lines ? ([["Lines", f.lines]] as [string, string][]) : []),
    ...(f.stops ? ([["Stops", f.stops]] as [string, string][]) : []),
    ...(f.vague ? ([["Where", "Roughly placed"]] as [string, string][]) : []),
  ];
  return (
    <article className="w-[min(21rem,calc(100vw-2rem))] space-y-3 p-4 text-left text-foreground">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg leading-tight font-semibold">{title}</h3>
          {address && <p className="mt-0.5 text-sm text-muted-foreground">{address}</p>}
        </div>
        <Close onClose={onClose} />
      </div>
      <Pill severity={event.severity} />
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t first:border-t-0">
              <th scope="row" className="w-24 py-1.5 pr-3 text-left align-top font-normal text-muted-foreground">
                {k}
              </th>
              <td className="py-1.5 align-top">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Footer event={event} languages={languages} />
    </article>
  );
}

// ---------- B: Verdict first ----------
// A coloured band says the answer as a sentence ("Some disruption for drivers · Now – 31.12.2027"), then what and
// where, then the rest as small labelled lines.
function VariantB({ event, languages, timeZone, onClose }: Props) {
  const { title, address } = plainTitle(event, languages);
  const f = facts(event, timeZone);
  const band = {
    info: "bg-muted",
    minor: "bg-muted",
    consider: "bg-amber-400 text-amber-950",
    major: "bg-red-600 text-white",
  }[event.severity];
  const verdict = `${SEVERITY[event.severity].label}${f.who ? ` for ${f.who.toLowerCase()}` : ""}`;
  return (
    <article className="w-[min(21rem,calc(100vw-2rem))] overflow-hidden text-left text-foreground">
      <div className={`flex items-start gap-2 px-4 pt-3 pb-3 ${band}`}>
        <div className="min-w-0 flex-1">
          <p className="text-base leading-tight font-bold">{verdict}</p>
          <p className="mt-1 flex items-center gap-1 text-sm opacity-90">
            <Clock aria-hidden className="size-3.5" />
            {f.when.main}
          </p>
          {f.when.hours && <p className="text-sm opacity-90">{f.when.hours}</p>}
        </div>
        <Close onClose={onClose} />
      </div>
      <div className="space-y-3 p-4">
        <div>
          <h3 className="leading-snug font-semibold">{title}</h3>
          {address && (
            <p className="flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin aria-hidden className="size-3.5 shrink-0" />
              {address}
            </p>
          )}
        </div>
        {(f.how.length > 0 || f.lines || f.stops || f.vague) && (
          <dl className="space-y-1 text-sm">
            {f.how.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">You'd see</dt>
                <dd>{f.how.map((h) => h.label).join(" · ")}</dd>
              </div>
            )}
            {f.lines && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Lines</dt>
                <dd>{f.lines}</dd>
              </div>
            )}
            {f.stops && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">Stops</dt>
                <dd>{f.stops}</dd>
              </div>
            )}
            {f.vague && <p className="text-muted-foreground">Roughly placed: the Source doesn't say exactly where.</p>}
          </dl>
        )}
        <Footer event={event} languages={languages} />
      </div>
    </article>
  );
}

// ---------- C: Tiles ----------
// The icon circle and title in a header row, then a 2×2 grid of fact tiles, each with an icon, a small label and
// the value. Empty tiles drop out; the grid reflows.
function VariantC({ event, languages, timeZone, onClose }: Props) {
  const { title, address } = plainTitle(event, languages);
  const f = facts(event, timeZone);
  const Who = WHO_ICONS[event.mainlyAffected];
  const tiles = [
    { label: "When", value: f.when.hours ? `${f.when.main}\n${f.when.hours}` : f.when.main, Icon: Clock },
    ...(f.who ? [{ label: "Affects", value: f.who, Icon: Who }] : []),
    ...(f.how.length ? [{ label: "You'd see", value: f.how.map((h) => h.label).join(", "), Icon: f.how[0]!.Icon }] : []),
    ...(f.lines ? [{ label: "Lines", value: f.lines, Icon: BusFront }] : []),
    ...(f.stops ? [{ label: "Stops", value: f.stops, Icon: MapPin }] : []),
  ];
  return (
    <article className="w-[min(21rem,calc(100vw-2rem))] space-y-3 p-4 text-left text-foreground">
      <div className="flex items-start gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full border-2 ${TONE_CLASSES[toneOf(event)]}`}>
          {event.mainlyAffected === "unknown" ? <Circle aria-hidden className="size-5" /> : <Who aria-hidden className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="leading-tight font-semibold">{title}</h3>
          {address && <p className="text-sm text-muted-foreground">{address}</p>}
          <div className="mt-1.5">
            <Pill severity={event.severity} />
          </div>
        </div>
        <Close onClose={onClose} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(({ label, value, Icon }, i) => (
          <div key={label} className={`rounded-lg bg-muted p-2.5 ${tiles.length % 2 && i === tiles.length - 1 ? "col-span-2" : ""}`}>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Icon aria-hidden className="size-3.5" />
              {label}
            </p>
            <p className="mt-0.5 text-sm leading-snug font-medium whitespace-pre-line">{value}</p>
          </div>
        ))}
      </div>
      {f.vague && <p className="text-xs text-muted-foreground">Roughly placed: the Source doesn't say exactly where.</p>}
      <Footer event={event} languages={languages} />
    </article>
  );
}

export function PrototypeEventCard({ variant, ...props }: Props & { variant: string | undefined }) {
  useTranslation();
  if (variant === "B") return <VariantB {...props} />;
  if (variant === "C") return <VariantC {...props} />;
  return <VariantA {...props} />;
}
