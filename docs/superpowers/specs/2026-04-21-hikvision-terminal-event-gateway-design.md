# Hikvision Terminal Event Gateway Design

## Summary

Build an in-process Hikvision terminal event gateway for the demo app that consumes each terminal's long-lived `alertStream`, normalizes multipart event payloads into a stable internal model, stores a bounded in-memory recent-event buffer with stream health state, and exposes that state to local consumers over JSON and Server-Sent Events (SSE).

This gateway is a separate subsystem from the existing `AcsEvent` polling flow. It will initially run in parallel with polling and optionally shadow-bridge normalized gateway events into the existing business ingest path for validation. Polling remains the source of truth until the gateway is proven reliable enough for cutover.

## Goals

- Consume Hikvision terminal event traffic through backend-managed digest-authenticated `alertStream` connections.
- Keep terminal credentials exclusively on the backend.
- Prevent the browser from connecting directly to Hikvision devices.
- Normalize raw multipart terminal events into a stable gateway event model.
- Maintain bounded in-memory buffers and stream-health metadata per terminal.
- Broadcast new events to app-local consumers through SSE.
- Expose snapshot/status JSON routes for dashboards and diagnostics.
- Expose helper routes for Hikvision event capability inspection and HTTP-host test actions.
- Support raw capture and offline summary generation for debugging.
- Support an off-by-default shadow bridge into the existing ingest flow for side-by-side validation.
- Commit at meaningful milestones during implementation instead of waiting for one final commit.

## Non-Goals

- Do not treat this feature as a true inbound webhook receiver.
- Do not register or mutate Hikvision webhook subscriptions as part of the first implementation.
- Do not expose device credentials, digest headers, or direct device URLs to the browser.
- Do not replace the existing polling flow in the first milestone.
- Do not add durable event persistence for the gateway's own recent-event buffer in the first milestone.

If explicit webhook callback support is needed later, it must be built as a separate feature with its own registration flow, inbound POST route surface, request verification, persistence, replay handling, and idempotency guarantees.

## Runtime Assumptions

- This demo app runs as a single long-lived Node.js process.
- In-memory gateway state is acceptable for the first version.
- `instrumentation.ts` is an acceptable place to start singleton background services.
- Gateway correctness matters more than horizontal scalability in this phase.

These assumptions deliberately allow an in-process supervisor and per-terminal in-memory sessions. If deployment expectations change later, the subsystem can be split into a worker/service boundary, but that is outside the scope of this design.

## Documentation And Existing References

The gateway should follow the device behavior already captured in repo-local tooling and docs:

- `docs/bruno/hikvision-value-series-isapi/01-status-events/alert-stream.bru`
  Confirms the direct device endpoint is `GET /ISAPI/Event/notification/alertStream` with digest auth.
- `docs/bruno/hikvision-value-series-isapi/00-discovery/subscribe-event-capabilities.bru`
  Confirms `GET /ISAPI/Event/notification/subscribeEventCap`.
- `docs/bruno/hikvision-value-series-isapi/00-discovery/http-hosts-capabilities.bru`
  Confirms `GET /ISAPI/Event/notification/httpHosts/capabilities`.
- `docs/bruno/hikvision-value-series-isapi/90-enrollment-push/http-hosts-test.bru`
  Confirms HTTP-host test behavior exists on the terminal-side event stack, though firmware may expose the test action under slightly different terminal-side paths.
- `packages/hikvision-isapi-sdk/src/client.ts`
  Already contains digest-auth request execution and alert-stream sampling/follow helpers.
- `packages/hikvision-isapi-sdk/src/utils.ts`
  Already contains multipart chunk reassembly and ACS event extraction helpers.
- `packages/hikvision-isapi-sdk/test/contracts.test.ts`
  Already tests multipart chunk reassembly and event extraction behavior.
- `scripts/smoke.mjs`
  Already includes a fake `alertStream` response shape that can be reused for independent testing.

Implementation should reuse these artifacts rather than introducing a second independent understanding of Hikvision `alertStream` behavior.

## Architecture

### High-Level Shape

The new subsystem will live alongside the current terminal polling code and will be isolated behind new gateway-specific modules and API routes.

Core layers:

1. `gateway supervisor`
   Starts once from `instrumentation.ts`, discovers eligible terminals, and manages one stream session per terminal.

2. `terminal stream session`
   Owns the long-lived alert-stream connection, reconnect loop, exponential backoff state, bounded recent-event buffer, summary counts, stream health, capture helpers, and SSE subscribers for one terminal.

3. `hikvision stream adapter`
   Reuses the existing SDK transport and multipart parsing helpers, then maps parsed payloads into the gateway's richer normalized event model.

4. `shadow bridge`
   Optional downstream adapter that maps gateway events into the existing ingest flow. It is disabled by default and does not own stream lifecycle.

5. `gateway route surface`
   Dedicated app API routes for snapshots, SSE, capture/debug utilities, and capability/test passthroughs.

### Why This Shape

- It keeps the always-on stream logic out of request handlers.
- It avoids mixing gateway state with current polling state.
- It lets the feature be tested independently before cutover.
- It preserves a clean cutover path: first observe, then shadow, then replace polling once validated.

## Normalized Gateway Event Model

Each normalized gateway event should preserve device detail while offering stable fields for UI and diagnostics.

Required fields:

- `sequence_index`
  Local per-session monotonic sequence number assigned by the gateway.
- `timestamp`
  Best-effort event timestamp from the payload, normalized to ISO when parseable; otherwise the raw value.
- `event_family`
  Top-level event family or type, for example `AccessControllerEvent` or `videoloss`.
- `description`
  Best-effort human description, derived from terminal fields when present.
- `major_event_type`
  Optional numeric event major code.
- `sub_event_type`
  Optional numeric event sub/minor code.
- `raw_payload`
  Full original parsed JSON body.
- `nested_payload`
  Extracted nested payload object when the device nests event-specific detail under a family key.
- `multipart`
  Multipart metadata such as part headers, part name, content type, and raw header map.

Additional recommended fields:

- `terminal_id`
- `terminal_name`
- `received_at`
- `event_state`
- `device_identifier`
- `terminal_identifier`
- `parse_warnings`

This model is intentionally richer than the current `NormalizedHikvisionTerminalEvent` used by polling. The gateway should not throw away fields before shadow validation is complete.

## Stream Lifecycle

### Startup

On startup, the gateway supervisor should:

- query the terminals collection
- identify monitor-ready terminals with usable device connection details
- start one stream session per eligible terminal
- stop sessions for removed or no-longer-eligible terminals

### Connection Behavior

Each session should:

- open `GET /ISAPI/Event/notification/alertStream` using backend-managed digest auth
- read the response as a long-lived `multipart/mixed` stream
- incrementally reassemble multipart parts across chunk boundaries
- parse part bodies as JSON when possible
- normalize each parsed part into the gateway event model
- append normalized events to the bounded buffer
- update stream health state
- fan out new events to local SSE subscribers

### Failure And Reconnect Behavior

When the stream drops, parsing fails at the connection level, or the device returns a bad stream response, the session should:

- mark stream state as disconnected or reconnecting
- store the latest error message
- preserve buffered events for inspection
- back off using exponential delays
- retry until the process shuts down or the terminal becomes ineligible

Backoff policy:

- initial delay: 1 second
- double on each failure
- cap at 30 seconds
- reset to 1 second after a healthy reconnection window or the first successfully parsed event after reconnect

## In-Memory State

Each terminal session should maintain:

- current stream state: `idle`, `connecting`, `connected`, `reconnecting`, `error`, `stopped`
- `connected` boolean
- `last_error`
- `last_event_at`
- `last_connected_at`
- `last_disconnected_at`
- `buffered_event_count`
- `summary_counts`
- bounded recent-event buffer
- active subscriber count
- capture/debug metadata

The supervisor should also provide aggregate state across all sessions for a future dashboard status card.

## API Surface

The first implementation should use a gateway-specific route namespace so it remains isolated from the current polling routes.

Recommended routes:

- `GET /api/terminals/gateway/status`
  Aggregate status across all gateway sessions.
- `GET /api/terminals/gateway/terminals/[id]`
  JSON snapshot for one terminal session including recent events and stream metadata.
- `GET /api/terminals/gateway/terminals/[id]/stream`
  SSE stream for one terminal's normalized gateway events.
- `GET /api/terminals/gateway/terminals/[id]/capabilities/subscribe-event`
  Proxy `subscribeEventCap`.
- `GET /api/terminals/gateway/terminals/[id]/capabilities/http-hosts`
  Proxy HTTP-host capabilities.
- `POST /api/terminals/gateway/terminals/[id]/http-hosts/[hostId]/test-listening-host`
  Trigger the terminal listening-host test.
- `POST /api/terminals/gateway/terminals/[id]/http-hosts/[hostId]/test-event-messages`
  Trigger the terminal event-message test.
- `POST /api/terminals/gateway/terminals/[id]/capture`
  Capture raw alert-stream traffic to files for debugging.
- `GET /api/terminals/gateway/captures/[captureId]/summary`
  Generate a human-readable summary from a saved raw multipart capture.

All routes must remain session-protected and backend-only.

The gateway's app-facing route names should stay stable even if device firmware differs. The underlying Hikvision adapter should resolve the concrete device-side action supported by the terminal, for example `/test`, `/testTheListeningHost`, or `/testEventMessages`, based on documented capability behavior and runtime device support.

## SSE Behavior

SSE should be the real-time local-consumer interface for the new gateway.

Behavior:

- On connect, send an initial `snapshot` event containing terminal status and the recent buffered events.
- On each new normalized event, send an `event` message containing the normalized gateway event.
- Periodically send a keepalive comment or heartbeat event to avoid idle proxy drops.
- On subscriber disconnect, cleanly unregister the subscriber from the terminal session.

The browser should consume the app's SSE endpoint only. It must never open an `EventSource` to the terminal device.

## Raw Capture And Offline Summary Support

Debugging support is a first-class requirement because device event behavior varies by terminal firmware and configuration.

### Raw Capture

The gateway should support bounded-time capture of raw alert-stream traffic:

- write raw multipart body to a file
- write response headers to a paired file
- store enough metadata to identify the capture later
- allow capture without disturbing the main session architecture where practical

For the first implementation, it is acceptable for capture to open a dedicated short-lived diagnostic stream rather than tapping the live session, as long as it is clearly documented.

### Offline Summary

The gateway should support converting saved raw multipart captures into a human-readable summary containing:

- chronological event listing
- discovered event families/signatures
- example fields
- notes on likely classifications

This should follow the same debugging philosophy already present in the prior prototype and the existing SDK tooling.

## Shadow Bridge

The shadow bridge exists to validate the gateway against the existing business event pipeline without replacing polling yet.

Rules:

- disabled by default
- per-terminal or global toggle, but backed by explicit configuration
- downstream only; it must not own stream lifecycle
- should map gateway events into the existing ingest surface in the smallest possible adapter layer
- should stamp source metadata so downstream records can be distinguished from polling-derived records

Recommended source labeling additions:

- extend event source tracking to include a gateway-specific source value
- preserve enough correlation data to compare gateway-derived records to polling-derived records

The shadow bridge should initially focus on the event types already understood by the current clocking ingest path. Unknown gateway events should remain visible in gateway diagnostics even if they are not bridged downstream.

## Interaction With Existing Polling

Phase 1 behavior:

- existing polling remains active
- gateway runs independently
- gateway shadow bridge is available but default-off
- terminal diagnostics can compare gateway output to polling output

Phase 2 behavior, after validation:

- enable shadow bridge in controlled testing
- compare gateway-derived ingest results against polling-derived ingest results
- surface mismatches in diagnostics

Phase 3 behavior, after acceptance:

- gateway becomes the primary live event source
- polling can be reduced or removed based on validation results

Cutover is not part of this design's implementation scope, but the design must preserve a clean path to that future milestone.

## Testing Strategy

The feature must be testable independently before any cutover work.

### Unit Tests

- multipart chunk reassembly feeding session-level parsing
- normalization of multipart JSON parts into the gateway event model
- nested payload extraction behavior
- bounded buffer trimming
- summary count generation
- stream state transitions and reconnect backoff
- SSE subscriber fanout behavior
- shadow bridge mapping behavior

### Integration Tests

- use the existing smoke-style fake Hikvision server pattern to simulate a terminal
- verify session startup connects to fake `alertStream`
- verify normalized events appear in JSON snapshots
- verify SSE subscribers receive the initial snapshot and subsequent events
- verify helper endpoints proxy the expected Hikvision capability/test routes
- verify capture route writes files and summary route reads them back

### Non-Goals For Initial Testing

- no multi-instance coordination tests
- no durable queue tests
- no inbound webhook tests

## Security And Safety

- never expose terminal usernames or passwords in JSON or SSE responses
- redact digest/auth headers from any saved debug output that could contain them
- keep route access behind existing app session checks
- keep the gateway's public route surface app-internal only

## Implementation Milestones And Commit Policy

The implementation should be broken into milestone commits rather than one large commit.

Recommended milestone sequence:

1. `feat: add hikvision gateway core session manager`
   Introduce the supervisor, per-terminal session lifecycle, in-memory state, and core normalized model.

2. `feat: add hikvision gateway snapshot and sse routes`
   Add JSON snapshots, SSE streaming, and protected route surface.

3. `feat: add hikvision gateway capability and capture diagnostics`
   Add capability helpers, HTTP-host test actions, raw capture, and offline summaries.

4. `feat: add hikvision gateway shadow ingest bridge`
   Add the disabled-by-default downstream bridge into the existing ingest path.

5. `test: add hikvision gateway integration coverage`
   Add or extend smoke/integration tests and documentation proving the subsystem works independently.

Each milestone must be verified before commit. If a milestone expands beyond a cleanly reviewable change, it should be split again.

## Risks And Trade-Offs

- In-memory state is acceptable for the demo, but restarts will drop recent gateway history.
- A long-lived stream per terminal assumes the app process remains healthy and persistent.
- Firmware differences may cause event payload shape drift, so preserving raw payloads is essential.
- Shadow-bridging can create duplicates if enabled carelessly; source labeling and comparison tooling are required.
- Alert-stream behavior may reveal events that polling never saw. That is expected and should be surfaced as a diagnostic advantage, not hidden.

## Acceptance Criteria

This design is satisfied when:

- the app can open and maintain a digest-authenticated `alertStream` session per eligible terminal
- new multipart event parts are normalized into the gateway event model
- recent events and stream-health state are available over protected JSON routes
- local consumers can receive live normalized events over protected SSE routes
- capability and HTTP-host helper routes work without exposing credentials
- raw capture and offline summary workflows are available for debugging
- the subsystem can run independently of existing polling
- the shadow bridge can be enabled explicitly for comparison without replacing polling
- milestone-based commits are used throughout implementation

## Open Decisions Already Resolved

- Deployment assumption: single long-lived Node app instance
- Isolation strategy: separate gateway subsystem inside the app
- Validation path: include an off-by-default shadow bridge into the existing ingest path
- Commit strategy: commit at each meaningful milestone
