import type { TravelMode } from "@pulse/client";
import type { Routine, RoutineTime, Weekday } from "@pulse/schema";
import { Link } from "@tanstack/react-router";
import { Repeat } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { NoUsualRoute, type RoutineDraft, sameEnds, useRoutines, WEEKDAYS, withUsualRoute } from "./routines.ts";
import { useSpeeds } from "./travelModes.ts";

// Making a Trip a Routine (CONTEXT.md), and changing one: the days it runs, and on each whether to leave at a time
// or be there by one. Where from and to stay as made.

const WORKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

type Days = Partial<Record<Weekday, RoutineTime>>;

export interface RoutineFormProps {
  ends: Pick<RoutineDraft, "from" | "to">;
  modes: TravelMode[];
  timeZone: string;
  // A Routine to change; without it, a new one runs on workdays at `initial`.
  editing?: Routine;
  initial?: RoutineTime;
  onDone: (saved: boolean) => void;
}

export function RoutineForm({ ends, modes, timeZone, editing, initial = { kind: "leaveAt", time: "08:00" }, onDone }: RoutineFormProps) {
  const { t } = useTranslation();
  const { save } = useRoutines();
  const { speeds } = useSpeeds();
  const [days, setDays] = useState<Days>(() => editing?.days ?? Object.fromEntries(WORKDAYS.map((d) => [d, initial])));
  // What a day gets when ticked: the last time set, so a week reads the same unless changed.
  const [last, setLast] = useState<RoutineTime>(() => Object.values(days).at(-1) ?? initial);
  const [failure, setFailure] = useState<"noWay" | "failed">();
  const [busy, setBusy] = useState(false);

  const set = (day: Weekday, time: RoutineTime | undefined) => {
    setDays((prev) => {
      const next = { ...prev };
      if (time) next[day] = time;
      else delete next[day];
      return next;
    });
    if (time) setLast(time);
    setFailure(undefined);
  };
  const ticked = WEEKDAYS.filter((d) => days[d]);
  const valid = ticked.length > 0 && ticked.every((d) => TIME.test(days[d]!.time));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      // Only the ticked days, in week order.
      const ordered = Object.fromEntries(ticked.map((d) => [d, days[d]!]));
      const input = await withUsualRoute({ ...ends, modes, days: ordered }, { now: new Date(), timeZone, ...(speeds ? { speeds } : {}) });
      await save.mutateAsync({ ...(editing ? { id: editing.id } : {}), input });
      onDone(true);
    } catch (error) {
      setFailure(error instanceof NoUsualRoute ? "noWay" : "failed");
    } finally {
      setBusy(false);
    }
  };

  const name = t("routineName", { from: ends.from.name, to: ends.to.name });
  return (
    <form
      className="home-add"
      aria-label={t(editing ? "routineChangeTitle" : "routineMakeTitle", {
        name,
      })}
      onSubmit={(e) => void submit(e)}
    >
      <p className="home-add-label">{name}</p>
      <fieldset className="routine-days">
        <legend className="settings-hint">{t("routineDaysHint")}</legend>
        {WEEKDAYS.map((day) => {
          const time = days[day];
          const dayName = t(`dayLong_${day}`);
          return (
            <div key={day} className="routine-day">
              <label className="settings-check routine-day-name">
                <input type="checkbox" checked={!!time} onChange={() => set(day, time ? undefined : last)} />
                <span aria-hidden>{t(`day_${day}`)}</span>
                <span className="sr-only">{dayName}</span>
              </label>
              {time && (
                <>
                  <select
                    className="routine-kind"
                    aria-label={t("routineKindOf", { day: dayName })}
                    value={time.kind}
                    onChange={(e) =>
                      set(day, {
                        ...time,
                        kind: e.target.value as RoutineTime["kind"],
                      })
                    }
                  >
                    <option value="leaveAt">{t("routineLeaveAtOption")}</option>
                    <option value="arriveBy">{t("routineArriveByOption")}</option>
                  </select>
                  <input
                    type="time"
                    className="routine-time"
                    aria-label={t("routineTimeOf", { day: dayName })}
                    required
                    value={time.time}
                    onChange={(e) => set(day, { ...time, time: e.target.value })}
                  />
                </>
              )}
            </div>
          );
        })}
      </fieldset>
      {failure && (
        <p role="alert" className="home-add-note">
          {t(failure === "noWay" ? "routineNoWay" : "routineFailed")}
        </p>
      )}
      <div className="home-add-actions">
        <button type="submit" className="home-add-save" disabled={!valid || busy}>
          {busy ? t("routineSaving") : t("routineSave")}
        </button>
        <button type="button" className="home-add-cancel" onClick={() => onDone(false)}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

// Under a Trip's result: make it one of your usual trips, or change the one it already is.
export function UsualTrip({ ends, modes, timeZone, initial }: Omit<RoutineFormProps, "editing" | "onDone">) {
  const { t } = useTranslation();
  const { routines } = useRoutines();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const existing = routines?.find((r) => sameEnds(r, ends));
  if (open)
    return (
      <RoutineForm
        ends={ends}
        modes={existing?.modes ?? modes}
        timeZone={timeZone}
        {...(existing ? { editing: existing } : {})}
        {...(initial ? { initial } : {})}
        onDone={(done) => {
          setOpen(false);
          setSaved(done);
        }}
      />
    );
  return (
    <div className="usual-trip">
      {saved && (
        <p role="status" className="settings-hint">
          {t("routineSaved")} <Link to="/settings">{t("routineSavedLink")}</Link>
        </p>
      )}
      <button type="button" className="here-save" onClick={() => setOpen(true)}>
        <Repeat aria-hidden className="size-4" />
        {t(existing ? "routineChange" : "routineMake")}
      </button>
    </div>
  );
}
