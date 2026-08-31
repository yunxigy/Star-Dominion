# Checkpoint durability and recovery

Research checkpoints are the execution-recovery boundary. Traces explain what happened; checkpoints contain the state required to continue without repeating completed planning, evidence, review, or writing work.

## Version 3 format

Every save produces:

- a uniquely named, immutable timestamped checkpoint JSON;
- an immutable `events-<sha-prefix>.jsonl.gz` event snapshot;
- an atomically replaced `latest.json` convenience snapshot;
- an atomically replaced `latest-path.txt` pointer.

Checkpoint v3 stores the full SHA-256 digest and compressed byte length of its event snapshot. Historical checkpoints reference their own immutable event content rather than a shared mutable sidecar. Versions 1 and 2 remain readable for backward compatibility.

Checkpoint JSON, pointer, event snapshot, and failure metadata writes use a temporary file in the destination directory, flush the file, rename it into place, and flush the directory where supported. Temporary files use owner-only permissions on POSIX systems. This prevents readers from observing a partially written replacement after a process interruption.

## Restore selection

Passing a checkpoint directory or its `latest.json` path enables recovery fallback:

1. validate `latest.json`;
2. if it is malformed, incomplete, or references a bad event snapshot, inspect timestamped checkpoints newest-first;
3. restore the newest checkpoint whose structure and event snapshot are valid.

An explicit non-`latest.json` checkpoint path is strict and does not silently switch to another point. This is useful when reproducing an exact historical state.

The HTTP cold-start artifact scanner uses the same checkpoint inspection path as the orchestrator. Consequently, `checkpointPath`, `resumeCheckpointPath`, replay data, and actual resume behavior agree even when the latest convenience file was interrupted.

## Validation and containment

Restore rejects:

- unsupported versions or invalid cursor stages/counters;
- missing core state or stack arrays;
- event paths containing directories or unsupported names;
- symbolic-link checkpoint/event files;
- oversized checkpoint or compressed event files;
- v3 event snapshots with missing or invalid checksum metadata;
- compressed size, SHA-256, event count, gzip, or JSONL mismatches;
- event decompression beyond the configured safety ceiling.

These checks treat imported or manually supplied checkpoints as untrusted local input and prevent event-sidecar path traversal and decompression abuse.

## Retention

`maxCheckpointFiles` retains at least one immutable timestamped checkpoint and defaults to four. Event snapshots are content-addressed and removed only when no retained checkpoint or `latest.json` references them. Multiple saves with identical event content reuse the same sidecar filename.

For production recovery, keep the entire checkpoint directory together. Copying only `latest.json` without its referenced `events-*.jsonl.gz` file is insufficient.
