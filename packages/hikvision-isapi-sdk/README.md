# Hikvision ISAPI SDK

Internal TypeScript SDK for Hikvision Face Recognition Terminals (Value Series) using ISAPI over HTTP Digest Authentication.

## What This SDK Covers

- Digest-authenticated ISAPI requests
- device probing and heartbeat checks
- face capture with `CaptureFaceData`
- FDLib count, add, apply, search, and verification workflows
- user setup and validation helpers
- access-control event search through `AcsEvent`
- live terminal event diagnostics through `alertStream`
- long-lived `consumeAlertStream()` multipart consumption plus event-capability and HTTP-host helper methods
- a CLI that is intended to be the primary terminal-debugging tool

## CLI-First Rule

For terminal integration work, the CLI is the source of truth.

Recommended workflow:

1. Run a CLI command against the real terminal.
2. Inspect the raw output bundle under `.tmp/hikvision-cli-runs/...`.
3. Confirm the real payload shape, event codes, and status fields.
4. Only then update app parser logic, filters, or UI mapping.

This keeps the UI secondary to confirmed device behavior.

## Configuration

```ts
import { HikvisionIsapiClient } from "@guard-management/hikvision-isapi-sdk";

const client = new HikvisionIsapiClient({
  host: process.env.HIKVISION_TEST_HOST!,
  username: process.env.HIKVISION_TEST_USERNAME!,
  password: process.env.HIKVISION_TEST_PASSWORD!,
  protocol: (process.env.HIKVISION_TEST_PROTOCOL as "http" | "https" | undefined) || "http",
  timeoutMs: 15000,
  retries: 1,
});
```

## Alert Stream APIs

The SDK exposes both bounded diagnostics and long-lived multipart consumption for terminal event traffic:

```ts
await client.consumeAlertStream({
  onPart(part) {
    console.log(part.headers["content-disposition"], part.events);
  },
});

const subscribeEventCap = await client.getSubscribeEventCapabilities();
const httpHostsCap = await client.getHttpHostsCapabilities();
await client.testHttpHostListening("1");
await client.testHttpHostEventMessages("1");
```

The HTTP-host test helpers try the firmware-specific terminal actions first and then fall back to `/test` when the device only exposes the generic action path.

## Environment Variables

Base live-test variables:

- `HIKVISION_TEST_HOST`
- `HIKVISION_TEST_USERNAME`
- `HIKVISION_TEST_PASSWORD`
- `HIKVISION_TEST_PROTOCOL` default `http`
- `HIKVISION_TEST_FDID`
- `HIKVISION_TEST_FACE_LIB_TYPE`
- `HIKVISION_TEST_TERMINAL_NO` optional
- `HIKVISION_TEST_CAPTURE_REQUIRED` set to `1` only when you want the live terminal camera capture test to run

Named CLI profile variables:

- `HIKVISION_PROFILE_<NAME>_HOST`
- `HIKVISION_PROFILE_<NAME>_USERNAME`
- `HIKVISION_PROFILE_<NAME>_PASSWORD`
- `HIKVISION_PROFILE_<NAME>_PROTOCOL`
- `HIKVISION_PROFILE_<NAME>_FDID`
- `HIKVISION_PROFILE_<NAME>_FACE_LIB_TYPE`
- `HIKVISION_PROFILE_<NAME>_TERMINAL_NO`

Event-search defaults:

- `HIKVISION_ACS_EVENT_MAJOR`
- `HIKVISION_ACS_EVENT_MINOR`
- `HIKVISION_ACS_EVENT_MINORS`

## CLI Overview

Run the CLI through the repo root script:

```bash
pnpm hikvision:cli --profile office <group> <action> [flags]
```

Grouped commands:

- `device`
  - `probe`
  - `heartbeat`
  - `info`
  - `access-capabilities`
  - `fdlib-capabilities`
- `events`
  - `capabilities`
  - `search`
  - `search-multi`
  - `stream-sample`
  - `stream-follow`
- `face`
  - `capture`
  - `count`
  - `search`
  - `add`
  - `apply`
  - `workflow`

Legacy flat command names such as `probe` and `count-faces` still work for compatibility.

## CLI Output Modes

Global output flag:

- `--output dual|raw|json|summary`

Default is `dual`.

Sections in dual mode:

1. `COMMAND SUMMARY`
2. `REQUEST`
3. `PARSED RESPONSE`
4. `RAW RESPONSE`

Every run also writes a timestamped bundle to:

```text
.tmp/hikvision-cli-runs/<timestamp>-<command>/
```

The bundle includes:

- `command.json`
- `summary.json`
- `parsed-response.json`
- `raw-response.json`
- per-exchange request and response bodies when textual
- extra artifacts such as alert-stream chunks

Secrets are redacted by default:

- passwords
- digest auth headers

## CLI Examples

Probe a terminal using a named profile:

```bash
pnpm hikvision:cli --profile office device probe
pnpm hikvision:cli --profile office device heartbeat
```

Search live access events:

```bash
pnpm hikvision:cli --profile office events search --major 5 --minor 75 --max-results 20
pnpm hikvision:cli --profile office events search-multi --major 5 --minors 75,76,80,94,104
```

Capture raw alert-stream output:

```bash
pnpm hikvision:cli --profile office events stream-sample --timeout-ms 5000 --max-bytes 8192
pnpm hikvision:cli --profile office events stream-follow --duration-seconds 20
```

Face-library operations:

```bash
pnpm hikvision:cli --profile office face count
pnpm hikvision:cli --profile office face search --fpid WS001
pnpm hikvision:cli --profile office face add --face-url http://192.168.0.194:3000/api/guards/abc/photo --fpid WS001 --name "John Doe" --employee-no WS001
pnpm hikvision:cli --profile office face apply --face-url http://192.168.0.194:3000/api/guards/abc/photo --fpid WS001 --name "John Doe" --employee-no WS001
```

Live integration suite:

```bash
pnpm test:hikvision:live
HIKVISION_TEST_CAPTURE_REQUIRED=1 pnpm test:hikvision:live
```

## Event Debugging Workflow

When clocking behavior is unclear:

1. `pnpm hikvision:cli --profile office device heartbeat`
2. `pnpm hikvision:cli --profile office events capabilities`
3. `pnpm hikvision:cli --profile office events search --major 5 --minor 75`
4. `pnpm hikvision:cli --profile office events search-multi --major 5 --minors 75,76,80,94,104`
5. `pnpm hikvision:cli --profile office events stream-sample`
6. Inspect the run bundle in `.tmp/hikvision-cli-runs/...`
7. Only after confirming the raw payloads should you update app-side filters or UI mapping

## Face Workflow Example

```ts
const result = await client.fullCaptureAndSyncWorkflow({
  fdid: "1",
  faceLibType: "blackFD",
  fpid: "EMP001",
  name: "Jane Guard",
  employeeNo: "EMP001",
});
```

Expected result shape:

```json
{
  "captureSucceeded": true,
  "uploadSucceeded": true,
  "verified": true,
  "fpid": "EMP001",
  "fdid": "1",
  "faceLibType": "blackFD"
}
```

## Troubleshooting

### Capability unsupported

- Check `getAccessControlCapabilities()` before capture operations.
- Check `getFdLibCapabilities()` before face-library operations.
- Check `getAcsEventCapabilities()` before event polling work.
- The SDK raises `HikvisionUnsupportedCapabilityError` when capability hints do not indicate support.

### Digest auth failure

- Confirm the terminal uses Digest auth and the credentials are correct.
- Re-run `pnpm hikvision:cli --profile office device probe`.
- Inspect the raw request and response bundle instead of relying on the summarized error.

### Capture never reaches 100

- Ensure the subject is standing in front of the terminal during capture.
- Retry or cancel the current capture session.
- Inspect the raw device response preserved in the CLI bundle.

### Add returns device error

- Verify `FDID` and `faceLibType`.
- Confirm the terminal supports `FaceDataRecord` or use `FDSetUp`.
- Check whether the device requires a URL-based face payload instead of `modelData`.

### Search returns no result

- Search by `FPID` first.
- Then search by `name` or `certificateNumber` if available.
- Verify the record count changed using `Count`.

### `isInLibrary` is `"no"` or `"unknown"`

- `"yes"` means the terminal reports modeling succeeded.
- `"no"` means the record exists but modeling is not complete or failed.
- Missing or unknown means the terminal did not expose modeling state in the response.

### Event polling returns `400`

- Use `events capabilities` to confirm which `major` and `minor` values the firmware actually supports.
- Prefer `events search-multi` over assuming the device will accept one broad multi-filter request.
- If `AcsEvent` stays strict, capture `alertStream` output and compare the raw event codes before adjusting app filters.

## Guide-Grounded Behavior vs Implementation Assumptions

### Grounded in the Hikvision ISAPI guide and collection

- device access is performed over ISAPI using Digest authentication
- face capture uses `POST /ISAPI/AccessControl/CaptureFaceData`
- face-library create uses `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`
- face-library search uses `POST /ISAPI/Intelligent/FDLib/FDSearch?format=json`
- face-library count uses `GET /ISAPI/Intelligent/FDLib/Count?format=json`
- face apply or upsert uses `PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json`
- access-control event history uses `POST /ISAPI/AccessControl/AcsEvent?format=json`
- alert stream uses `GET /ISAPI/Event/notification/alertStream`
- success is determined by HTTP success plus ISAPI status fields when present

### Implementation assumptions

- capability checks use keyword and hint matching because capability payload shapes differ across firmware
- `fullCaptureAndSyncWorkflow()` prefers URL-based capture output for FDLib compatibility when possible
- the CLI stores redacted artifacts by default because raw terminal payloads often contain credentials
- when XML or multipart payloads are too irregular to normalize safely, the SDK preserves raw text instead of inventing structure
- heartbeat is represented in the SDK via `AcsWorkStatus` because that is the reliable live-status surface already supported by the device integration

## Architecture Summary

- `src/auth/digest.ts`: Digest challenge parsing and Authorization header generation
- `src/client.ts`: transport, retries, timeouts, response validation, and public SDK methods
- `src/debug.ts`: fetch tracing and redaction helpers for raw diagnostic work
- `src/models.ts`: typed request, response, debug, and capture models
- `src/errors.ts`: custom exception hierarchy
- `src/workflows/face.ts`: reusable face workflow entrypoint
- `src/cli.ts`: grouped CLI with raw artifacts and event diagnostics

## Assumptions

- this package is an internal SDK for the guard-management backend
- the CLI is the primary direct-device diagnostic surface
- real-device integration tests are manually gated
- activation challenge and encryption flows are out of scope for v1
- FDLib operations require caller-supplied `FDID` and `faceLibType`

## Open Questions

- exact `FDSearch` request body shape varies by firmware family
- some firmware returns URL-based capture output, others binary or multipart payloads
- `modelData` encoding requirements are not fully explicit in the Value Series material
- access-control event search can require firmware-specific `major` and `minor` combinations
- some firmware families emit richer event detail through `alertStream` than through `AcsEvent`
