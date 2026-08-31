import { randomUUID } from "node:crypto";

let episodeSeq = 0;
const processInstanceId = randomUUID().slice(0, 8);

export function isoNow(now: () => number): string {
  return new Date(now()).toISOString();
}

export function generateEpisodeId(now: () => number): string {
  episodeSeq += 1;
  const stamp = new Date(now()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const day = stamp.slice(0, 8);
  const time = stamp.slice(9, 15);
  return `EP_${day}_${time}_${String(episodeSeq).padStart(3, "0")}_${processInstanceId}`;
}

export function validateEpisodeId(episodeId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(episodeId)) {
    throw new Error("episodeId must be 1-128 characters, start with an alphanumeric character, and contain only letters, numbers, '.', '_' or '-'");
  }
  return episodeId;
}

export function eventIdForEpisode(episodeId: string, sequence: number): string {
  return `ME_${shortId(episodeId || "episode")}_${String(sequence).padStart(6, "0")}`;
}

export function shortId(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32)
    || "item";
}
