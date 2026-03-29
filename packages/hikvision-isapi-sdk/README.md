# Hikvision ISAPI SDK

Internal TypeScript SDK for Hikvision Face Recognition Terminals (Value Series) using ISAPI over HTTP Digest Authentication.

## What It Covers

- Digest-authenticated request execution
- capability inspection
- face capture with `CaptureFaceData`
- FDLib count, add, apply, search, and verification flows
- webhook/httpHosts inspection, configuration, and testing
- Node CLI for live-device troubleshooting

## Configuration

The SDK is device-centric and does not depend on Mongo or Next.js route objects.

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

## Environment Variables

- `HIKVISION_TEST_HOST`
- `HIKVISION_TEST_USERNAME`
- `HIKVISION_TEST_PASSWORD`
- `HIKVISION_TEST_PROTOCOL` default `http`
- `HIKVISION_TEST_FDID`
- `HIKVISION_TEST_FACE_LIB_TYPE`
- `HIKVISION_TEST_TERMINAL_NO` optional
- `HIKVISION_TEST_CAPTURE_REQUIRED` set to `1` only when you want the live terminal camera capture test to run

## CLI Examples

```bash
pnpm hikvision:cli probe --host 192.168.0.179 --username admin --password secret
pnpm hikvision:cli count-faces --fdid 1 --face-lib-type blackFD
pnpm hikvision:cli search-faces --fdid 1 --face-lib-type blackFD --fpid EMP001
pnpm hikvision:cli webhook-test --host-id 1
HIKVISION_TEST_CAPTURE_REQUIRED=1 pnpm test:hikvision:live
```

## Live Workflow Example

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
- The SDK raises `HikvisionUnsupportedCapabilityError` when capability hints do not indicate support.

### Digest auth failure

- Confirm the terminal uses Digest auth and the device credentials are correct.
- Re-run `pnpm hikvision:cli probe ...` and verify the terminal does not reject the second request.

### Capture never reaches 100

- Ensure the subject is standing in front of the terminal during capture.
- Retry or cancel the current capture session.
- Inspect the raw device response preserved in the SDK result.

### Add returns device error

- Verify `FDID` and `faceLibType`.
- Confirm the terminal supports `FaceDataRecord` or use `FDSetUp`.
- Check whether the device requires a URL-based face payload instead of `modelData`.

### Search returns no result

- Search by `FPID` first.
- Then search by `name` or `certificateNumber` if available.
- Verify the record count changed using `Count`.

### `isInLibrary` is `"no"` or `"unknown"`

- `"yes"` means the device reports modeling succeeded.
- `"no"` means the record exists but modeling is not complete or failed.
- Missing/unknown means the terminal did not expose modeling state in the response.

## Guide-Grounded Behavior vs Implementation Assumptions

### Grounded in the Hikvision ISAPI guide / collection

- device access is performed over ISAPI using Digest authentication
- face capture uses `POST /ISAPI/AccessControl/CaptureFaceData`
- face-library create uses `POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json`
- face-library search uses `POST /ISAPI/Intelligent/FDLib/FDSearch?format=json`
- face-library count uses `GET /ISAPI/Intelligent/FDLib/Count?format=json`
- face apply/upsert uses `PUT /ISAPI/Intelligent/FDLib/FDSetUp?format=json`
- success is determined by HTTP success plus ISAPI status fields when present

### Implementation assumptions

- capability checks use keyword/hint matching because capability payload shapes differ across firmware
- `fullCaptureAndSyncWorkflow()` prefers URL-based capture output for direct FDLib workflow compatibility
- when XML payloads are too irregular to normalize safely, the SDK preserves raw XML text for callers instead of inventing structure
- CLI command names and JSON output shapes are application-side ergonomics, not device-guide contracts

## Architecture Summary

- `src/auth/digest.ts`: Digest challenge parsing and Authorization header generation
- `src/client.ts`: transport, retries, timeouts, response validation, and public SDK methods
- `src/models.ts`: typed request/response models
- `src/errors.ts`: custom exception hierarchy
- `src/workflows/face.ts`: reusable face workflow entrypoint
- `src/workflows/events.ts`: reusable webhook/httpHosts helpers
- `src/cli.ts`: operator-facing Node CLI

## Assumptions

- this package is an internal SDK for the guard-management backend
- real-device integration tests are manually gated
- activation challenge/encryption flows are out of scope for v1
- FDLib operations require caller-supplied `FDID` and `faceLibType`

## Open Questions

- exact `FDSearch` request body shape can vary by firmware family
- some firmware returns URL-based capture output, others binary or multipart payloads
- `modelData` encoding requirements are not fully explicit in the Value Series material
- capability payload schemas vary enough that richer XML normalization may be worth adding later
