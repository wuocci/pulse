import { ChevronUp } from "lucide-react";
import { type PointerEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type Snap, snapAfterDrag } from "./sheet-snap.ts";

// The bottom sheet over the map: always there, dragged by its header between a peek and nearly full height.
// A labelled region of the page, not a dialog: the map and its controls stay usable and reachable behind it.
// The Expand/Collapse button does what dragging does, for keyboards and screen readers.

// The peek is the header: the handle, the title row and the controls, plus the home bar's inset on phones that
// have one. Measured; this is its height without an inset, which the map leaves uncovered (PointMap.tsx).
export const PEEK_PX = 144;

export interface SheetProps {
  // The status line: what the peek tells you at a glance.
  title: string;
  // The app's controls, always in the peek.
  controls: ReactNode;
  // What expanding the sheet shows.
  children: ReactNode;
}

interface DragState {
  startY: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  travel: number;
}

export function Sheet({ title, controls, children }: SheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const sheet = useRef<HTMLElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const [peekPx, setPeekPx] = useState(PEEK_PX);
  const drag = useRef<DragState | null>(null);
  const [snap, setSnap] = useState<Snap>("peek");
  // While dragging: how far the finger has moved (negative is up).
  const [dy, setDy] = useState<number | null>(null);
  const expanded = snap === "expanded";

  useLayoutEffect(() => {
    const el = header.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPeekPx(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const travel = () => Math.max(0, (sheet.current?.offsetHeight ?? peekPx) - peekPx);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Let the button take its own clicks.
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, lastY: e.clientY, lastTime: e.timeStamp, velocity: 0, travel: travel() };
    setDy(0);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const elapsed = e.timeStamp - d.lastTime;
    if (elapsed > 0) d.velocity = (e.clientY - d.lastY) / elapsed;
    d.lastY = e.clientY;
    d.lastTime = e.timeStamp;
    setDy(e.clientY - d.startY);
  };

  const onPointerEnd = () => {
    const d = drag.current;
    if (!d) return;
    setSnap((from) => snapAfterDrag({ from, dy: d.lastY - d.startY, velocity: d.velocity, travel: d.travel }));
    drag.current = null;
    setDy(null);
  };

  // Expanded sits at 0; the peek is pushed down by the full travel. A drag moves it from there, within the ends.
  const offset = (() => {
    const base = expanded ? 0 : travel();
    if (dy === null) return expanded ? "0px" : `calc(100% - ${peekPx}px)`;
    return `${Math.min(Math.max(base + dy, 0), travel())}px`;
  })();

  return (
    <section
      ref={sheet}
      aria-labelledby={titleId}
      className={`fixed inset-x-0 bottom-0 z-10 flex h-[90dvh] flex-col rounded-t-xl border-t bg-popover text-popover-foreground shadow-lg ${dy === null ? "motion-safe:transition-transform motion-safe:duration-300" : ""}`}
      style={{ transform: `translateY(${offset})` }}
    >
      <div
        ref={header}
        className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted-foreground/30" />
        <div className="flex items-center justify-between gap-2 px-4 pt-2">
          <h2 id={titleId} className="font-heading text-base font-medium">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-expanded={expanded}
            aria-label={expanded ? t("collapse") : t("expand")}
            onClick={() => setSnap(expanded ? "peek" : "expanded")}
          >
            <ChevronUp aria-hidden className={`motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`} />
          </Button>
        </div>
        <div className="flex items-center gap-2 px-4 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{controls}</div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
    </section>
  );
}
