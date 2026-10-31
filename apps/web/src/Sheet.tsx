import { ChevronUp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type Snap, snapAfterDrag } from "./sheet-snap.ts";

// The bottom sheet over the map: always there, dragged by its header between a peek and nearly full height.
// A labelled region of the page, not a dialog: the map and its controls stay usable and reachable behind it.
// The Expand/Collapse button does what dragging does, for keyboards and screen readers.

// The peek is the header: the handle, what's on top and the controls row, plus the home bar's inset on phones that
// have one. Measured; this is its height without an inset, which the map leaves uncovered (PointMap.tsx).
export const PEEK_PX = 144;

// From this width the sheet is a panel docked on the left: no dragging, no Expand, but it can be hidden.
export const DOCKED_MEDIA = "(min-width: 64rem)";
// The docked panel's width (lg:w-90); the map lies under it and centres in the rest.
export const PANEL_PX = 360;

export interface SheetProps {
  // Names the sheet for screen readers.
  title: string;
  // Above the controls row, always visible, e.g. a search field.
  top?: ReactNode;
  // The controls in the peek, next to the Expand/Collapse button.
  peek: ReactNode;
  // What expanding the sheet shows.
  children: ReactNode;
  // The peek's measured height, for the map to centre above it.
  onPeekHeight?: (px: number) => void;
  // Docked only: the panel slid away, and the button that does it.
  hidden?: boolean;
  onHiddenChange?: (hidden: boolean) => void;
}

function useDocked(): boolean {
  const [docked, setDocked] = useState(() => window.matchMedia?.(DOCKED_MEDIA).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(DOCKED_MEDIA);
    if (!media) return;
    const onChange = () => setDocked(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return docked;
}

interface DragState {
  startY: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  travel: number;
}

export function Sheet({ title, top, peek, children, onPeekHeight, hidden = false, onHiddenChange }: SheetProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const docked = useDocked();
  const onPeekHeightRef = useRef(onPeekHeight);
  onPeekHeightRef.current = onPeekHeight;
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
    const observer = new ResizeObserver(() => {
      setPeekPx(el.offsetHeight);
      onPeekHeightRef.current?.(el.offsetHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const travel = () => Math.max(0, (sheet.current?.offsetHeight ?? peekPx) - peekPx);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    // Controls in the header keep their own taps; only the rest drags.
    if ((e.target as HTMLElement).closest("button, input, [role=option]")) return;
    if (window.matchMedia?.(DOCKED_MEDIA).matches) return;
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

  const panelHidden = docked && hidden;

  return (
    <>
    <section
      ref={sheet}
      id={titleId + "-panel"}
      aria-labelledby={titleId}
      // A hidden panel's controls are out of reach for keyboards and screen readers too.
      inert={panelHidden}
      className={`fixed inset-x-0 bottom-0 z-10 flex h-[90dvh] flex-col rounded-t-xl border-t bg-popover text-popover-foreground shadow-lg lg:inset-y-0 lg:right-auto lg:h-dvh lg:w-90 lg:transform-none! lg:rounded-none lg:border-t-0 lg:border-r lg:shadow-none lg:motion-safe:transition-[translate] lg:motion-safe:duration-300 ${panelHidden ? "lg:-translate-x-full" : ""} ${dy === null ? "motion-safe:transition-transform motion-safe:duration-300" : ""}`}
      style={{ transform: `translateY(${offset})` }}
    >
      <div
        ref={header}
        className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing lg:cursor-auto lg:touch-auto"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div aria-hidden className="mx-auto mt-3 h-1.5 w-12 rounded-full bg-muted-foreground/30 lg:hidden" />
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        {top && <div className="px-4 pt-3">{top}</div>}
        <div className="flex items-center gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {peek}
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 lg:hidden"
            aria-expanded={expanded}
            aria-label={expanded ? t("collapse") : t("expand")}
            onClick={() => setSnap(expanded ? "peek" : "expanded")}
          >
            <ChevronUp aria-hidden className={`motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
    </section>
    {/* On the panel's edge; at the screen's edge while the panel is hidden. */}
    <Button
      variant="outline"
      size="icon"
      // Moves with the panel: same property timing as its slide, and no press nudge (it would shift the click).
      className={`fixed top-[calc(50%-1.375rem)] z-10 hidden size-11 rounded-l-none border-l-0 bg-popover shadow-sm active:not-aria-[haspopup]:translate-y-0 lg:inline-flex lg:motion-safe:transition-[left] lg:motion-safe:duration-300 ${hidden ? "left-0" : "left-90"}`}
      aria-label={hidden ? t("showPanel") : t("hidePanel")}
      aria-expanded={!hidden}
      aria-controls={titleId + "-panel"}
      onClick={() => onHiddenChange?.(!hidden)}
    >
      {hidden ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
    </Button>
    </>
  );
}
