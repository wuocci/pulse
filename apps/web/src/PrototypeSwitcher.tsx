// PROTOTYPE — throwaway. Floating bar to flip ?variant= on the current route; ← and → keys too. Dev builds only.
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export function PrototypeSwitcher({ variants, names, current }: { variants: readonly string[]; names: Record<string, string>; current: string }) {
  const navigate = useNavigate({ from: "/" });
  const i = Math.max(0, variants.indexOf(current));
  const go = (step: number) => {
    const next = variants[(i + step + variants.length) % variants.length]!;
    void navigate({ search: (prev) => ({ ...prev, variant: next }), replace: true });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  if (!import.meta.env.DEV) return null;
  return (
    <div className="fixed top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-700 px-1 py-1 text-sm font-semibold text-white shadow-lg">
      <button type="button" aria-label="Previous variant" className="grid size-9 place-items-center rounded-full hover:bg-white/20" onClick={() => go(-1)}>
        <ChevronLeft aria-hidden className="size-5" />
      </button>
      <span className="px-1 whitespace-nowrap">
        {variants[i]} ({names[variants[i]!]})
      </span>
      <button type="button" aria-label="Next variant" className="grid size-9 place-items-center rounded-full hover:bg-white/20" onClick={() => go(1)}>
        <ChevronRight aria-hidden className="size-5" />
      </button>
    </div>
  );
}
