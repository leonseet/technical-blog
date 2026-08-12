// Tees the orchestrator console stream — everything the implement loops write to
// process stdout/stderr, both logger() lines and the stray console.log() blanks
// between waves — to a single staged transcript, then copies that transcript
// into each per-unit folder the run touched.
//
//   import { startRunLog } from "../helpers/runLog.mts";
//   const runLog = startRunLog("implement", { logsRoot: logsRoot() });
//   runLog.addTarget(sessionLogDir);              // as each target is discovered
//   runLog.finalize([]);                          // at clean end of run
//
// The staged file (logs/.run/<basename>-<stamp>.log) is appended live, one
// chunk at a time, so a crash still leaves a complete-up-to-the-crash transcript
// on disk. Folder copies happen on finalize() and, best-effort, on process exit
// / SIGINT / SIGTERM so an interrupted run still fans the transcript out to the
// folders known so far. The file is written ANSI-free regardless of whether the
// terminal got color.

import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** SGR color escapes — the only ANSI the logger emits (via styleText). */
const SGR = /\x1b\[[0-9;]*m/g;

export function stripAnsi(text: string): string {
  return text.replace(SGR, "");
}

/** Sortable local timestamp `YYYYMMDD-HHMMSS` (chronological in `ls`). */
export function runStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

export type RunLog = {
  /** Path of the live staged transcript under logs/.run/. */
  readonly stagePath: string;
  /** Bare file name (`<basename>-<stamp>.log`) used in each target folder. */
  readonly fileName: string;
  /** Register a folder to receive a copy of the transcript on finalize/exit. */
  addTarget(dir: string): void;
  /** Restore the patched streams and copy the transcript into every target
   *  folder (those registered via addTarget plus any passed here). Idempotent. */
  finalize(dirs: string[]): void;
};

export function startRunLog(
  basename: string,
  opts: { logsRoot: string; now?: Date },
): RunLog {
  const stamp = runStamp(opts.now ?? new Date());
  const fileName = `${basename}-${stamp}.log`;
  const stageDir = join(opts.logsRoot, ".run");
  mkdirSync(stageDir, { recursive: true });
  const stagePath = join(stageDir, fileName);
  writeFileSync(stagePath, ""); // create now so it exists as a crash artifact

  // Patch a stream's write() to also append an ANSI-stripped copy of every chunk
  // to the staged transcript. Returns a restore fn. Logging must never break the
  // run, so a tee failure is swallowed and the original write still happens.
  const patch = (stream: NodeJS.WriteStream): (() => void) => {
    const original = stream.write.bind(stream);
    const tee = (chunk: unknown, enc?: unknown, cb?: unknown) => {
      try {
        const text =
          typeof chunk === "string"
            ? chunk
            : Buffer.isBuffer(chunk)
              ? chunk.toString("utf8")
              : String(chunk);
        appendFileSync(stagePath, stripAnsi(text));
      } catch {
        /* tee is best-effort; never let it break the real write */
      }
      return (original as (...a: unknown[]) => boolean)(chunk, enc, cb);
    };
    stream.write = tee as typeof stream.write;
    return () => {
      stream.write = original as typeof stream.write;
    };
  };

  const restores = [patch(process.stdout), patch(process.stderr)];
  const targets = new Set<string>();
  let finalized = false;

  const finalize = (dirs: string[]): void => {
    for (const d of dirs) targets.add(d);
    if (finalized) return;
    finalized = true;
    for (const restore of restores) restore();
    for (const dir of targets) {
      try {
        mkdirSync(dir, { recursive: true });
        copyFileSync(stagePath, join(dir, fileName));
      } catch {
        /* best-effort fan-out; the staged file is the durable record */
      }
    }
  };

  // Best-effort copy on an interrupted run, to the folders known so far.
  process.once("exit", () => finalize([]));
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      finalize([]);
      process.exit(130);
    });
  }

  return {
    stagePath,
    fileName,
    addTarget: (dir) => void targets.add(dir),
    finalize,
  };
}
