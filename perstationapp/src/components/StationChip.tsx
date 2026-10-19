import { cn } from "@/lib/utils";
import type { StationKind } from "@/lib/api";

const BG: Record<StationKind, string> = {
  start: "bg-start text-white",
  checkpoint: "bg-checkpoint text-ink",
  finish: "bg-finish text-white",
};
const LABEL: Record<StationKind, string> = { start: "START", checkpoint: "CHECKPOINT", finish: "FINISH" };

/** Station kind is always color AND word; the ink band is never the only signal. */
export function StationChip({
  name,
  kind,
  big = false,
  className,
}: {
  name: string | null;
  kind: StationKind | null;
  big?: boolean;
  className?: string;
}) {
  if (!name || !kind) {
    return (
      <span className={cn("inline-flex items-stretch border-2 border-dashed border-ink font-semibold uppercase", big ? "text-xl" : "text-xs", className)}>
        <span className="px-2 py-0.5">No station</span>
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-stretch border-2 border-ink font-bold uppercase leading-none", big ? "text-xl" : "text-xs", className)}>
      <span className={cn("px-2 py-1 tracking-wider", BG[kind])}>{LABEL[kind]}</span>
      <span className="whitespace-nowrap bg-sheet px-2 py-1">{name}</span>
    </span>
  );
}
