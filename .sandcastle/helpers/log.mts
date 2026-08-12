// Console logger for the planner-driven implementation loop. Every line is:
//
//   HH:MM:SS  [tag]  <indent><symbol> message
//
//   import { logger } from "../helpers/log.mts";
//
//   const log = logger(unit.id);       // [tag] = id suffix after the last hyphen
//   log.header(`unit → ${branch}`);
//   log.step(`${child.id}: ${child.title}`);
//   log.ok(`${child.id} closed`, { since: t0 });   // appends a dim (2m14s)
//   const top = logger();              // no id → reserved dim [ · ] tag
//
// Color comes from node:util styleText, gated by wantsColor() so redirected/CI
// logs stay plain (just clock + tag structure) while terminals get color.
// fail() writes to stderr; everything else to stdout.

import { join } from "node:path";
import type { WriteStream } from "node:tty";
import { styleText } from "node:util";

import { mainWorktreeRoot } from "./git.mts";

type Style = Parameters<typeof styleText>[0];

/** Pad the [tag] inner text to this width so the column stays aligned. The real
 *  ids are like `agentic-reid-poc-4yo`, whose unique suffix is 3 chars. */
const TAG_WIDTH = 3;

/** The id segment after the last hyphen — the only part that varies across this
 *  repo's issues (the long `agentic-reid-poc-` prefix carries no information).
 */
function short(id: string): string {
  const i = id.lastIndexOf("-");
  return i === -1 ? id : id.slice(i + 1);
}

/** Root of the sandcastle log tree, anchored to the primary worktree even when
 *  a loop is launched from a linked worktree. */
export function logsRoot(): string {
  return join(mainWorktreeRoot(process.cwd()), ".sandcastle", "logs");
}

/** Compact duration from milliseconds, e.g. 134000 -> "2m14s". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/** Conventional color gating: NO_COLOR (any presence) wins, then FORCE_COLOR,
 *  else the destination must be a TTY. styleText on this Node version ignores all
 *  of these, so we decide here and only colorize when wanted. */
function wantsColor(stream: NodeJS.WritableStream): boolean {
  if ("NO_COLOR" in process.env) return false;
  const force = process.env.FORCE_COLOR;
  if (force !== undefined && force !== "0" && force !== "false") return true;
  return Boolean((stream as Partial<WriteStream>).isTTY);
}

function clockNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** A color function for one stream, honoring the same TTY/NO_COLOR/FORCE_COLOR
 *  gate as the logger: applies styleText when color is wanted, else identity. */
function painterFor(
  stream: NodeJS.WritableStream,
): (styles: Style, text: string) => string {
  const color = wantsColor(stream);
  return (styles, text) => (color ? styleText(styles, text) : text);
}

type EventStyle = {
  readonly symbol: string;
  readonly styles: Style;
  readonly indent: number;
  readonly stderr?: boolean;
};

const EVENTS = {
  header: { symbol: "══", styles: ["bold"], indent: 0 },
  step: { symbol: "→", styles: [], indent: 1 },
  ok: { symbol: "✓", styles: ["green"], indent: 1 },
  warn: { symbol: "⚠", styles: ["yellow"], indent: 1 },
  retry: { symbol: "↺", styles: ["yellow"], indent: 1 },
  skip: { symbol: "⏭", styles: ["dim"], indent: 1 },
  fail: { symbol: "✗", styles: ["red"], indent: 1, stderr: true },
} satisfies Record<string, EventStyle>;

type Method = keyof typeof EVENTS;

export type Logger = Record<
  Method,
  (message: string, opts?: { since?: number }) => void
>;

export function logger(id?: string): Logger {
  const tag = (id ? short(id) : "·").padEnd(TAG_WIDTH);

  function emitLine(
    out: NodeJS.WritableStream,
    paint: (styles: Style, text: string) => string,
    body: string,
    since?: number,
  ): void {
    const clock = paint(["dim"], clockNow());
    const label = `[${paint([id ? "cyan" : "dim"], tag)}] `;
    const dur =
      since === undefined
        ? ""
        : paint(["dim"], ` (${formatDuration(Date.now() - since)})`);
    out.write(`${clock}  ${label}${body}${dur}\n`);
  }

  function emit(ev: EventStyle, message: string, since?: number): void {
    const out = ev.stderr ? process.stderr : process.stdout;
    const paint = painterFor(out);
    const indent = "  ".repeat(ev.indent);
    emitLine(out, paint, `${indent}${paint(ev.styles, `${ev.symbol} ${message}`)}`, since);
  }

  const make =
    (ev: EventStyle) => (message: string, o?: { since?: number }) =>
      emit(ev, message, o?.since);

  return {
    header: make(EVENTS.header),
    step: make(EVENTS.step),
    ok: make(EVENTS.ok),
    warn: make(EVENTS.warn),
    retry: make(EVENTS.retry),
    skip: make(EVENTS.skip),
    fail: make(EVENTS.fail),
  };
}
