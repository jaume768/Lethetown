import type { SimEvent } from "@lethetown/shared";
import { formatGameTime } from "@lethetown/agent-core";

const COLORS: Record<SimEvent["kind"], string> = {
  action: "\x1b[37m",
  speech: "\x1b[36m",
  observation: "\x1b[90m",
  plan: "\x1b[33m",
  system: "\x1b[35m",
};

export function formatEvent(e: SimEvent, color = process.stdout.isTTY): string {
  const line = `[${formatGameTime(e.time)}] ${e.text}`;
  return color ? `${COLORS[e.kind]}${line}\x1b[0m` : line;
}
