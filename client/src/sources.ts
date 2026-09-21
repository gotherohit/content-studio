import type { Source, SourceFile } from "./types";

/**
 * The project folder is the source of truth for file sources: whatever is in its sources/
 * folder is what the project has. A file dropped in from Explorer becomes a source, and a
 * file that has gone takes its source with it.
 *
 * The rule is applied to the project **as it stands**, never to a copy taken before an
 * asynchronous listing: deciding against a stale list adopted the same file twice.
 */
export function adoptFiles(
  sources: Source[],
  onDisk: SourceFile[],
  make: (file: SourceFile, index: number) => Source,
): Source[] | null {
  const names = new Set(onDisk.map((f) => f.name));
  const known = new Set(sources.filter((s) => s.kind === "file").map((s) => s.file?.name));
  const added = onDisk.filter((f) => !known.has(f.name)).map(make);
  // A code source points at a file outside the project, so it is never adopted or dropped.
  const kept = sources.filter((s) => s.kind !== "file" || names.has(s.file?.name ?? ""));
  if (!added.length && kept.length === sources.length) return null;
  return [...kept, ...added];
}
