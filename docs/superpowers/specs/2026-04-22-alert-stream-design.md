# Alert-Stream Snapshot Refactor Design

## Summary

Create a new feature branch named `alert-stream` and move automatic Hikvision snapshot capture from a timer-driven rolling buffer to direct, event-triggered capture driven only by the long-lived `alertStream` gateway path.

On this branch, the app will stop taking camera snapshots every second and buffering them in memory. Instead, when the Hikvision gateway receives an `alertStream` event that normalizes into a clocking/authentication event, the backend will immediately fetch a fresh terminal snapshot, store it in GridFS, and attach the resulting metadata directly to the saved clocking event.

This is a full refactor rather than a surgical patch. The snapshot buffer subsystem, snapshot-cycle monitor behavior, and the terminal camera snapshot card used for this flow should be removed instead of left dormant.

## Goals

- Make `alertStream` the only automatic snapshot trigger on this branch.
- Capture snapshots only for gateway events that normalize into clocking/authentication events.
- Remove timer-driven snapshot buffering and matching logic.
- Preserve the existing stored event snapshot contract so downstream event and shift views continue to work.
- Keep event ingest resilient when snapshot capture fails.
- Simplify runtime behavior and operator understanding of how snapshots are created.

## Non-Goals

- Do not trigger automatic snapshots from the older `AcsEvent` polling path.
- Do not trigger automatic snapshots for every raw `AccessControllerEvent`.
- Do not remove stored event snapshot viewing from shift or event detail surfaces.
- Do not change manual terminal snapshot APIs unless they are only used by the removed UI.
- Do not redesign the broader Hikvision gateway or attendance flow beyond what is needed for this refactor.

## Current State

Today the app uses two separate mechanisms:

1. `alertStream` gateway ingestion for live Hikvision events.
2. A timer-driven snapshot buffer that captures terminal images continuously and later tries to match the closest buffered frame to a saved clocking event.

This creates extra moving parts:

- snapshot timers in the live monitor
- in-memory buffer retention and matching windows
- lag-compensation heuristics
- extra UI/status copy describing buffering instead of event-driven capture

The branch goal is to remove that complexity and align snapshot creation with the actual event source we now trust: `alertStream`.

## Branch Scope

This design is intended for the feature branch `alert-stream`.

Because this is a dedicated branch for the new approach, the branch should prefer cleanup over temporary compatibility layers. If a timer-driven snapshot behavior is no longer part of the desired model, it should be deleted rather than hidden behind flags unless a flag is required to keep tests or migrations stable during implementation.

## Architecture

### High-Level Shape

- `alertStream` continues to be consumed by the existing gateway session layer.
- Gateway events continue to bridge into shared clocking event ingest.
- Automatic snapshot capture moves into the event ingest path for newly created `terminal_gateway` clocking/authentication events.
- The old snapshot buffer subsystem is removed.
- The periodic snapshot cycle in the live monitor is removed.

### New Automatic Snapshot Rule

An automatic snapshot is taken only when all of the following are true:

- the event source is `terminal_gateway`
- the event was newly created, not deduplicated
- the normalized event qualifies as a clocking/authentication event

No other event source or event family should trigger automatic capture on this branch.

### Why This Shape

- It aligns snapshots with the actual event that caused the clocking record.
- It removes guesswork introduced by matching against earlier or later buffered frames.
- It reduces constant terminal load from periodic snapshot polling.
- It makes the behavior easier to explain: "gateway clocking event arrived, then snapshot was captured."

## Data Flow

### Event Path

1. A Hikvision terminal emits `alertStream` multipart events.
2. The gateway session parses and normalizes those events.
3. The shadow bridge forwards normalized gateway events into shared ingest.
4. Shared ingest creates a `clocking_events` record when the event is new.
5. If the event is a qualifying `terminal_gateway` clocking/authentication event, the backend immediately fetches a fresh terminal snapshot.
6. The snapshot is uploaded to GridFS and its metadata is written back to the event record.

### Snapshot Storage Contract

The direct-capture helper should return the same persisted metadata fields already used elsewhere:

- `snapshot_file_id`
- `snapshot_filename`
- `snapshot_mime_type`
- `snapshot_size`
- `snapshot_captured_at`

Keeping this shape stable avoids unnecessary downstream changes to event snapshot routes and shift/event UIs.

## Module-Level Design

### `lib/clocking-event-ingest.ts`

This becomes the decision point for automatic snapshot capture.

Required behavior:

- keep existing deduplication first
- create the event record
- if the event qualifies for direct gateway capture, run snapshot capture as best-effort follow-up work
- update the created event with snapshot metadata when capture succeeds

This keeps the trigger rule centralized and prevents accidental snapshot capture from polling-based ingest.

### `lib/event-snapshots.ts`

This module should be refactored away from buffer semantics and into direct event snapshot capture helpers.

Remove concepts tied to the old design:

- terminal snapshot buffer collection naming
- in-memory buffered frame maps
- retention limits
- frame count summaries
- closest-frame matching
- lag-compensation heuristics

Keep or replace only the parts that still make sense:

- GridFS upload/download helpers for event snapshots
- event snapshot loading for stored events
- a predicate for whether an event is a face-authentication/clocking event
- a new helper that captures a snapshot directly for a terminal event

### `lib/terminal-live-monitor.ts`

The live monitor should continue to own heartbeat and event poll cycles, but it should no longer run or report a snapshot cycle.

Remove:

- snapshot timer state
- snapshot cycle promises
- snapshot-related response fields
- per-terminal snapshot-buffer summary fields

### `lib/live-event-trace.ts`

The live trace should remain, but its vocabulary should describe direct capture instead of buffer matching.

Recommended trace outcomes:

- `captured`
- `skipped`
- `error`

Recommended fields:

- capture started/finished timestamps
- capture duration
- snapshot file id when successful
- skip reason when not attempted
- capture error when the request or upload fails

## UI Scope

### Remove Snapshot Buffer Messaging

The live monitor dashboard should no longer describe snapshot buffering or snapshot cycle timing.

Update any copy or badges that currently mention:

- snapshot buffering
- snapshot interval milliseconds
- buffered terminals
- last snapshot cycle
- frame counts from the buffer

### Remove Camera Snapshot Card

The terminal camera snapshot card used in the current terminal details/events experience should be removed from that flow on this branch.

This includes:

- removing the mounted snapshot card from the terminal details/events page
- removing related copy that suggests a live camera preview is part of this automatic event workflow

### Keep Stored Event Snapshot Viewing

Users should still be able to view snapshots already attached to stored events, especially through:

- event snapshot API routes
- shift attendance views
- any event detail surfaces that display `snapshot_file_id`

The refactor changes how snapshots are created, not whether stored snapshots can be viewed.

## Error Handling

Snapshot capture is best-effort enrichment.

If a qualifying gateway event is ingested and the snapshot fetch fails:

- keep the clocking event
- do not roll back attendance or event creation
- record the failure in the live trace
- leave snapshot metadata unset on the event

If the event is deduplicated:

- do not trigger a second snapshot capture

If the event does not qualify:

- explicitly mark the trace as skipped when tracing is enabled

## Testing Strategy

The refactor should be driven by tests that prove the new rules and delete obsolete behavior.

Required test coverage:

- a newly created `terminal_gateway` clocking/authentication event captures and persists a snapshot
- a polling-based clocking/authentication event does not trigger automatic snapshot capture
- a non-qualifying gateway event does not trigger automatic snapshot capture
- snapshot capture failure still preserves the created clocking event
- live monitor status no longer exposes snapshot-cycle fields
- the terminal details/events UI no longer renders the camera snapshot card

Obsolete tests for rolling buffer capture and closest-frame matching should be removed or replaced, not retained against dead behavior.

## Migration And Compatibility Notes

- Existing stored event snapshots remain valid because their persisted metadata shape is unchanged.
- Existing manual snapshot APIs can remain if they still serve another explicit manual workflow; otherwise they can be removed in a follow-up cleanup.
- Polling remains available for event history/diagnostics, but it is no longer part of automatic snapshot creation on this branch.

## Risks

- Direct snapshot capture happens slightly after event ingest, so the captured image may reflect a moment after the event rather than a buffered near-event frame.
- Some terminals may respond more slowly to immediate snapshot requests under load.
- Removing the buffer means losing the ability to retroactively match a frame after the fact.

These trade-offs are acceptable for this branch because the product direction is to prefer a simple, event-driven capture model over a continuously running snapshot buffer.

## Success Criteria

- No automatic timer-driven snapshot buffering remains in the runtime.
- Only `alertStream`-originated clocking/authentication events capture automatic snapshots.
- Stored event snapshot viewing continues to work with no schema change.
- The terminal details/events page no longer shows the camera snapshot card for this flow.
- The live monitor reflects event polling only, not snapshot buffering.
