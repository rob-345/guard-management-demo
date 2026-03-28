import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const baseUrl = new URL(process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000");
const email = process.env.SMOKE_EMAIL || process.env.ADMIN_EMAIL || "admin@westec.co.zw";
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || "Password@123";
const ingestSecret =
  process.env.SMOKE_INGEST_SECRET ||
  process.env.EVENT_INGEST_SECRET ||
  "demo-ingest-secret";
const tinyJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEBAPEA8QDxAQEA8PDw8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGy8lICUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAgMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQMC/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6A//xAAXEAEBAQEAAAAAAAAAAAAAAAABEQAh/9oACAEBAAEFAm2r/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwEf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwEf/8QAGhAAAgMBAQAAAAAAAAAAAAAAAQIAESExQf/aAAgBAQAGPwKc6jI5/8QAGxABAQADAAMAAAAAAAAAAAAAAREAITFBUWH/2gAIAQEAAT8hYk5S3H1YI5x2o9iH/9oADAMBAAIAAwAAABB//8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPxAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPxAf/8QAGxABAAICAwAAAAAAAAAAAAAAAQARITFBUWH/2gAIAQEAAT8QjQ6EuKXXSb9VjA36TObgGJE0E7E=",
  "base64"
);

let cookieHeader = "";
const cleanupTargets = [];

function log(step) {
  console.log(`→ ${step}`);
}

function pass(step) {
  console.log(`✓ ${step}`);
}

function fail(step, details) {
  throw new Error(`${step}: ${details}`);
}

async function startFakeHikvisionServer() {
  const server = createServer(async (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    let jsonBody = {};
    if (rawBody.trim()) {
      try {
        jsonBody = JSON.parse(rawBody);
      } catch {
        jsonBody = {};
      }
    }

    const sendJson = (status, payload) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload));
    };

    const sendText = (status, payload, contentType = "text/plain") => {
      res.statusCode = status;
      res.setHeader("Content-Type", contentType);
      res.end(payload);
    };

    if (method === "GET" && url.pathname === "/SDK/activateStatus") {
      return sendText(200, "activated");
    }

    if (method === "GET" && url.pathname === "/ISAPI/System/deviceInfo") {
      return sendJson(200, {
        deviceInfo: {
          deviceName: "Smoke Hikvision Face Terminal",
          deviceID: "FAKE-DEVICE-ID-001",
          serialNumber: "FAKE-SERIAL-001",
          macAddress: "00:11:22:33:44:55",
          model: "DS-K1T671TM",
          hardwareVersion: "V1.0",
          firmwareVersion: "V2.3.4",
          firmwareReleasedDate: "2026-01-01"
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/System/capabilities") {
      return sendJson(200, {
        SystemCapabilities: {
          support: true
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/AccessControl/capabilities") {
      return sendJson(200, {
        AccessControlCapabilities: {
          support: true
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/AccessControl/UserInfo/capabilities") {
      return sendJson(200, {
        UserInfoCap: {
          maxUserCount: 1000
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/Intelligent/FDLib/capabilities") {
      return sendJson(200, {
        FDLibCap: {
          maxFaceCount: 100
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/Intelligent/FDLib") {
      return sendJson(200, {
        FDLibList: {
          FDLib: [
            {
              FDID: "1",
              faceLibType: "staticFD",
              name: "Smoke Face Library"
            }
          ]
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/AccessControl/FaceRecognizeMode") {
      return sendJson(200, {
        FaceRecognizeMode: {
          mode: "face_only"
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/Event/notification/subscribeEventCap") {
      return sendJson(200, {
        SubscribeEventCap: {
          support: true
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/Event/notification/httpHosts/capabilities") {
      return sendJson(200, {
        HttpHostNotificationCap: {
          support: true,
          httpAuthenticationMethod: ["none", "basic", "digest"]
        }
      });
    }

    if (method === "GET" && url.pathname === "/ISAPI/AccessControl/AcsWorkStatus") {
      return sendJson(200, {
        AcsWorkStatus: {
          antiSneakStatus: "open",
          hostAntiDismantleStatus: "close",
          cardReaderOnlineStatus: [1, 1],
          cardReaderAntiDismantleStatus: [0, 0],
          cardReaderVerifyMode: [2, 2],
          cardNum: 7,
          netStatus: "online",
          interfaceStatusList: [{ id: 1, netStatus: "online" }],
          sipStatus: "connected",
          ezvizStatus: "connected",
          voipStatus: "connected",
          wifiStatus: "connected",
          doorStatus: [1, 0],
          doorLockStatus: [0, 0],
          magneticStatus: [1, 1]
        }
      });
    }

    if (
      method === "PUT" &&
      (url.pathname === "/ISAPI/Event/notification/httpHosts" ||
        /^\/ISAPI\/Event\/notification\/httpHosts\/[^/]+$/.test(url.pathname))
    ) {
      return sendJson(200, {
        HttpHostNotification: jsonBody.HttpHostNotification || jsonBody
      });
    }

    if (method === "POST" && url.pathname === "/ISAPI/Event/notification/httpHosts") {
      return sendJson(200, {
        HttpHostNotification: jsonBody.HttpHostNotification || jsonBody
      });
    }

    if (
      (method === "GET" || method === "POST") &&
      /^\/ISAPI\/Event\/notification\/httpHosts\/[^/]+\/test$/.test(url.pathname)
    ) {
      return sendText(200, "OK");
    }

    if (method === "PUT" && url.pathname === "/ISAPI/AccessControl/UserInfo/SetUp") {
      if (!jsonBody?.UserInfo?.Valid) {
        return sendJson(400, {
          statusCode: 6,
          statusString: "Invalid Content",
          subStatusCode: "MessageParametersLack",
          errorCode: 1610612761,
          errorMsg: "The message parameter is missing, the required node does not exist.Valid"
        });
      }

      return sendJson(200, {
        UserInfo: jsonBody.UserInfo || {}
      });
    }

    if (method === "POST" && url.pathname === "/ISAPI/AccessControl/UserInfo/Search") {
      if (jsonBody?.UserInfoSearchCond?.hasFace === true) {
        return sendJson(200, {
          UserInfoSearch: {
            searchID: jsonBody?.UserInfoSearchCond?.searchID || "face-count",
            responseStatusStrg: "OK",
            numOfMatches: 1,
            totalMatches: 1,
            UserInfo: [
              {
                employeeNo: "SMOKE-001",
                name: "Smoke Guard",
                numOfFace: 1
              }
            ]
          }
        });
      }

      return sendJson(200, {
        UserInfoSearch: {
          searchID: jsonBody?.UserInfoSearchCond?.searchID || "search",
          responseStatusStrg: "OK",
          numOfMatches: 0,
          totalMatches: 0,
          UserInfo: []
        }
      });
    }

    if (method === "POST" && url.pathname === "/ISAPI/Intelligent/FDLib/pictureUpload") {
      return sendJson(400, {
        statusCode: 4,
        statusString: "Invalid Operation",
        subStatusCode: "notSupport",
        errorCode: 1073741825,
        errorMsg: "notSupport"
      });
    }

    if (method === "POST" && url.pathname === "/ISAPI/Intelligent/FDLib/FaceDataRecord") {
      if (
        !jsonBody ||
        typeof jsonBody !== "object" ||
        typeof jsonBody.faceURL !== "string" ||
        typeof jsonBody.faceLibType !== "string" ||
        typeof jsonBody.FDID !== "string" ||
        typeof jsonBody.FPID !== "string"
      ) {
        return sendJson(400, {
          statusCode: 6,
          statusString: "Invalid Content",
          subStatusCode: "MessageParametersLack",
          errorCode: 1610612761,
          errorMsg: "The message parameter is missing, the required node does not exist.FPID"
        });
      }

      return sendJson(200, {
        statusCode: 1,
        statusString: "OK",
        subStatusCode: "ok",
        FPID: jsonBody.FPID
      });
    }

    if (method === "POST" && url.pathname === "/ISAPI/AccessControl/CaptureFaceData") {
      if (rawBody.includes("<cancelFlag>true</cancelFlag>")) {
        return sendText(
          200,
          '<?xml version="1.0" encoding="UTF-8"?><ResponseStatus><statusString>OK</statusString></ResponseStatus>',
          "application/xml"
        );
      }

      if (rawBody.includes("<dataType>binary</dataType>")) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/jpeg");
        res.end(tinyJpeg);
        return;
      }

      return sendText(
        400,
        '<?xml version="1.0" encoding="UTF-8"?><ResponseStatus><statusString>deviceBusy</statusString><subStatusCode>deviceBusy</subStatusCode><errorMsg>deviceBusy</errorMsg></ResponseStatus>',
        "application/xml"
      );
    }

    if (method === "PUT" && url.pathname === "/ISAPI/AccessControl/UserInfoDetail/Delete") {
      if (!jsonBody?.UserInfoDetail?.mode) {
        return sendJson(400, {
          statusCode: 6,
          statusString: "Invalid Content",
          subStatusCode: "MessageParametersLack",
          errorCode: 1610612761,
          errorMsg: "The message parameter is missing, the required node does not exist.mode"
        });
      }

      return sendJson(200, {
        success: true
      });
    }

    if (method === "DELETE" && url.pathname === "/ISAPI/Intelligent/FDLib/FaceDataRecord") {
      return sendText(200, "OK");
    }

    res.statusCode = 404;
    res.end("Not found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start fake Hikvision server");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

function mergeCookies(response) {
  const getSetCookie = response.headers.getSetCookie;
  const cookies =
    typeof getSetCookie === "function"
      ? getSetCookie.call(response.headers)
      : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")]
        : [];

  const sessionCookie = cookies.find((cookie) => cookie.startsWith("session="));
  if (sessionCookie) {
    cookieHeader = sessionCookie.split(";", 1)[0];
  }
}

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  return fetch(new URL(path, baseUrl), {
    ...init,
    headers,
    redirect: "manual"
  });
}

async function expectStatus(step, response, expected) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    const body = await response.text();
    fail(step, `expected ${allowed.join(" or ")}, received ${response.status} (${body})`);
  }
}

async function requestJson(path, init = {}, step = path) {
  const headers = new Headers(init.headers || {});
  const body = init.body;
  let serializedBody = body;

  const isBinaryLike =
    typeof FormData !== "undefined" && body instanceof FormData
      ? true
      : typeof Blob !== "undefined" && body instanceof Blob
        ? true
        : typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer
          ? true
          : typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body)
            ? true
            : false;

  if (
    body !== undefined &&
    body !== null &&
    !isBinaryLike &&
    typeof body !== "string"
  ) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    serializedBody = JSON.stringify(body);
  }

  const response = await request(path, {
    ...init,
    headers,
    body: serializedBody
  });
  const expected =
    init.method === "POST" ? [200, 201] : init.method === "DELETE" ? [200, 204] : 200;
  await expectStatus(step, response, expected);
  if (response.status === 204) return null;
  return response.json();
}

async function deleteIfPresent(path) {
  const response = await request(path, { method: "DELETE" });
  if (response.status === 404) {
    return;
  }

  await expectStatus(`cleanup ${path}`, response, [200, 204]);
}

async function main() {
  const runId = randomUUID().slice(0, 8);
  const fakeHikvision = await startFakeHikvisionServer();
  const fakeHikvisionHost = new URL(fakeHikvision.baseUrl).host;

  try {
    log("checking protected page redirect");
    const unauthenticatedDashboard = await request("/dashboard");
    await expectStatus("protected dashboard redirect", unauthenticatedDashboard, [307, 308]);
    const loginLocation = unauthenticatedDashboard.headers.get("location") || "";
    if (!loginLocation.endsWith("/login")) {
      fail("protected dashboard redirect", `expected /login, received ${loginLocation}`);
    }
    pass("protected page redirects to /login");

    log("logging in");
    const loginResponse = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    await expectStatus("login", loginResponse, 200);
    mergeCookies(loginResponse);
    pass("login succeeds and sets a session cookie");

    log("checking authenticated dashboard");
    const authenticatedDashboard = await request("/dashboard");
    await expectStatus("authenticated dashboard", authenticatedDashboard, 200);
    pass("authenticated dashboard is accessible");

    log("checking protected API");
    const guardsResponse = await request("/api/guards");
    await expectStatus("protected API", guardsResponse, 200);
    const guards = await guardsResponse.json();
    if (!Array.isArray(guards)) {
      fail("protected API", "expected guards response to be an array");
    }
    pass("protected API returns data for authenticated sessions");

    log("creating site, shift, guard, and terminal");
    const site = await requestJson(
      "/api/sites",
      {
        method: "POST",
        body: {
          name: `Smoke Site ${runId}`,
          address: "1 Smoke Test Way",
          region: "North",
          contact_person: "Smoke Supervisor",
          contact_phone: "+263700000000",
          latitude: 5.6037,
          longitude: -0.187
        }
      },
      "create site"
    );
    cleanupTargets.push({ path: `/api/sites/${site.id}`, label: "site" });

    const shift = await requestJson(
      "/api/shifts",
      {
        method: "POST",
        body: {
          name: `Smoke Shift ${runId}`,
          start_time: "08:00",
          end_time: "16:00"
        }
      },
      "create shift"
    );
    cleanupTargets.push({ path: `/api/shifts/${shift.id}`, label: "shift" });

    const guardCreateForm = new FormData();
    guardCreateForm.append("employee_number", `SM-${runId.toUpperCase()}`);
    guardCreateForm.append("full_name", "Smoke Guard");
    guardCreateForm.append("phone_number", "+263700000001");
    guardCreateForm.append("email", "smoke.guard@example.com");
    guardCreateForm.append("status", "active");
    guardCreateForm.append(
      "photo_file",
      new Blob([Buffer.from(`guard-photo-${runId}`)], { type: "image/jpeg" }),
      `guard-${runId}.jpg`
    );

    const guard = await requestJson("/api/guards", { method: "POST", body: guardCreateForm }, "create guard");
    cleanupTargets.push({ path: `/api/guards/${guard.id}`, label: "guard" });

    const terminal = await requestJson(
      "/api/terminals",
      {
        method: "POST",
        body: {
          name: `Smoke Terminal ${runId}`,
          ip_address: fakeHikvisionHost,
          username: "admin",
          password: "admin123",
          site_id: site.id
        }
      },
      "create terminal"
    );
    cleanupTargets.push({ path: `/api/terminals/${terminal.id}`, label: "terminal" });

    if (site.name !== `Smoke Site ${runId}` || site.latitude !== 5.6037 || site.longitude !== -0.187) {
      fail("create site", "site data was not persisted");
    }
    if (shift.name !== `Smoke Shift ${runId}`) {
      fail("create shift", "shift name was not persisted");
    }
    if (guard.employee_number !== `SM-${runId.toUpperCase()}` || !guard.photo_file_id) {
      fail("create guard", "guard photo upload or employee number was not persisted");
    }
    if (terminal.site_id !== site.id || !terminal.webhook_token) {
      fail("create terminal", "terminal registration data was not persisted");
    }
    pass("create endpoints persist records");

    log("capturing a face from the terminal");
    const captureFaceResponse = await request(`/api/terminals/${terminal.id}/capture-face`, {
      method: "POST"
    });
    await expectStatus("capture face", captureFaceResponse, 200);
    if (!((captureFaceResponse.headers.get("content-type") || "").startsWith("image/"))) {
      fail("capture face", "expected terminal capture to return an image");
    }
    pass("terminal face capture proxy returns an image");

    log("cancelling an idle terminal capture session");
    const cancelCaptureResponse = await requestJson(
      `/api/terminals/${terminal.id}/capture-face/cancel`,
      { method: "POST" },
      "cancel terminal capture"
    );
    if (!cancelCaptureResponse?.success) {
      fail("cancel terminal capture", "terminal capture session did not cancel cleanly");
    }
    pass("terminal capture sessions can be cancelled");

    log("verifying guard photo streaming");
    const guardPhotoResponse = await request(`/api/guards/${guard.id}/photo`);
    await expectStatus("guard photo", guardPhotoResponse, 200);
    if (!((guardPhotoResponse.headers.get("content-type") || "").startsWith("image/"))) {
      fail("guard photo", "expected an image response");
    }
    pass("guard photos are stored and streamed from GridFS");

    log("updating site, shift, guard, and terminal");
    const updatedSite = await requestJson(
      `/api/sites/${site.id}`,
      {
        method: "PATCH",
        body: {
          region: "Central",
          contact_person: "Updated Supervisor",
          contact_phone: "+263700000099",
          latitude: 5.71,
          longitude: -0.2
        }
      },
      "update site"
    );
    if (
      updatedSite.region !== "Central" ||
      updatedSite.contact_person !== "Updated Supervisor" ||
      updatedSite.latitude !== 5.71 ||
      updatedSite.longitude !== -0.2
    ) {
      fail("update site", "site updates were not persisted");
    }

    const updatedShift = await requestJson(
      `/api/shifts/${shift.id}`,
      {
        method: "PATCH",
        body: {
          name: `Smoke Shift ${runId} Updated`,
          end_time: "17:00"
        }
      },
      "update shift"
    );
    if (updatedShift.name !== `Smoke Shift ${runId} Updated` || updatedShift.end_time !== "17:00") {
      fail("update shift", "shift updates were not persisted");
    }

    const guardUpdateForm = new FormData();
    guardUpdateForm.append("full_name", "Updated Smoke Guard");
    guardUpdateForm.append("status", "suspended");
    guardUpdateForm.append(
      "photo_file",
      new Blob([Buffer.from(`guard-photo-updated-${runId}`)], { type: "image/jpeg" }),
      `guard-${runId}-updated.jpg`
    );
    const updatedGuard = await requestJson(
      `/api/guards/${guard.id}`,
      {
        method: "PATCH",
        body: guardUpdateForm
      },
      "update guard"
    );
    if (
      updatedGuard.full_name !== "Updated Smoke Guard" ||
      updatedGuard.status !== "suspended" ||
      updatedGuard.photo_file_id === guard.photo_file_id
    ) {
      fail("update guard", "guard updates were not persisted");
    }

    const updatedTerminal = await requestJson(
      `/api/terminals/${terminal.id}`,
      {
        method: "PATCH",
        body: {
          name: `Smoke Terminal ${runId} Updated`,
          status: "offline"
        }
      },
      "update terminal"
    );
    if (updatedTerminal.name !== `Smoke Terminal ${runId} Updated` || updatedTerminal.status !== "offline") {
      fail("update terminal", "terminal updates were not persisted");
    }
    pass("update endpoints persist changes");

    log("verifying read-backs");
    const readSite = await requestJson(`/api/sites/${site.id}`, { method: "GET" }, "read site");
    const readShift = await requestJson(`/api/shifts/${shift.id}`, { method: "GET" }, "read shift");
    const readGuard = await requestJson(`/api/guards/${guard.id}`, { method: "GET" }, "read guard");
    const readTerminal = await requestJson(
      `/api/terminals/${terminal.id}`,
      { method: "GET" },
      "read terminal"
    );

    if (
      readSite.id !== site.id ||
      readShift.id !== shift.id ||
      readGuard.id !== guard.id ||
      readTerminal.id !== terminal.id
    ) {
      fail("read-back verification", "one or more records could not be read back");
    }
    pass("dynamic read endpoints return created records");

    log("probing terminal");
    const probedTerminal = await requestJson(
      `/api/terminals/${terminal.id}/probe`,
      { method: "POST" },
      "probe terminal"
    );
    if (probedTerminal.device_uid !== "FAKE-SERIAL-001" || probedTerminal.status !== "online") {
      fail("probe terminal", "terminal probe snapshot was not refreshed");
    }
    pass("terminal probe persists the current device snapshot");

    log("configuring webhook");
    const webhookConfig = await requestJson(
      `/api/terminals/${terminal.id}/webhook-configure`,
      {
        method: "POST",
        body: {}
      },
      "configure webhook"
    );
    if (!webhookConfig.callback_url || webhookConfig.terminal?.webhook_status !== "configured") {
      fail("configure webhook", "webhook was not configured");
    }
    const callbackHost = new URL(webhookConfig.callback_url).hostname;
    if (["localhost", "127.0.0.1", "::1"].includes(callbackHost)) {
      fail("configure webhook", `callback URL is still local-only (${webhookConfig.callback_url})`);
    }
    pass("webhook configuration persists the callback URL");

    log("testing webhook");
    const webhookTest = await requestJson(
      `/api/terminals/${terminal.id}/webhook-test`,
      { method: "POST" },
      "test webhook"
    );
    if (!webhookTest.success) {
      fail("test webhook", "webhook test did not report success");
    }
    pass("webhook test succeeds");

    log("sending callback event");
    const callbackEvent = await requestJson(
      `/api/events/hikvision/${terminal.webhook_token}`,
      {
        method: "POST",
        body: {
          employeeNo: guard.employee_number,
          eventType: "clock_in",
          dateTime: new Date().toISOString()
        }
      },
      "hikvision callback"
    );
    if (!callbackEvent.success) {
      fail("hikvision callback", "callback ingest did not report success");
    }
    pass("tokenized Hikvision callbacks are ingested");

    log("checking terminal details for webhook activity");
    const terminalDetailsResponse = await request(`/dashboard/terminals/${terminal.id}`);
    await expectStatus("terminal details", terminalDetailsResponse, 200);
    const terminalDetailsHtml = await terminalDetailsResponse.text();
    if (
      !terminalDetailsHtml.includes("Webhook test") ||
      !terminalDetailsHtml.includes("clock_in") ||
      !terminalDetailsHtml.includes(guard.employee_number)
    ) {
      fail("terminal details webhook activity", "webhook deliveries are not visible on the terminal details page");
    }
    pass("terminal details surface webhook delivery activity");

    log("syncing guard face to terminal");
    const faceSync = await requestJson(
      `/api/guards/${guard.id}/face-sync`,
      {
        method: "POST",
        body: {
          terminal_ids: [terminal.id]
        }
      },
      "face sync"
    );
    if (!faceSync.facial_imprint_synced || faceSync.results?.[0]?.status !== "synced") {
      fail("face sync", "guard face did not sync successfully");
    }
    pass("guard faces can be enrolled on a terminal");

    log("removing guard face from terminal");
    const faceRemove = await requestJson(
      `/api/guards/${guard.id}/face-remove`,
      {
        method: "POST",
        body: {
          terminal_ids: [terminal.id]
        }
      },
      "face remove"
    );
    if (faceRemove.results?.[0]?.status !== "removed") {
      fail("face remove", "guard face did not remove successfully");
    }
    pass("guard faces can be removed from a terminal");

    log("syncing guard face again");
    const faceSyncAgain = await requestJson(
      `/api/guards/${guard.id}/face-sync`,
      {
        method: "POST",
        body: {
          terminal_ids: [terminal.id]
        }
      },
      "face sync again"
    );
    if (!faceSyncAgain.facial_imprint_synced || faceSyncAgain.results?.[0]?.status !== "synced") {
      fail("face sync again", "guard face did not sync successfully after removal");
    }
    pass("guard faces can be re-synced after removal");

    log("editing terminal");
    const terminalEdit = await requestJson(
      `/api/terminals/${terminal.id}`,
      {
        method: "PATCH",
        body: {
          name: `${terminal.name} Updated`,
          site_id: site.id,
          ip_address: terminal.ip_address,
          username: terminal.username,
          snapshot_stream_id: terminal.snapshot_stream_id || "101"
        }
      },
      "edit terminal"
    );
    if (terminalEdit.name !== `${terminal.name} Updated`) {
      fail("edit terminal", "terminal edit did not persist");
    }
    pass("terminal edit updates the stored record");

    log("confirming site deletion is blocked while terminal exists");
    const blockedSiteDelete = await request(`/api/sites/${site.id}`, { method: "DELETE" });
    await expectStatus("blocked site delete", blockedSiteDelete, 409);
    pass("site deletion is blocked while terminals are still assigned");

    log("deleting terminal");
    await requestJson(`/api/terminals/${terminal.id}`, { method: "DELETE" }, "delete terminal");
    const guardAfterTerminalDelete = await requestJson(`/api/guards/${guard.id}`, {}, "guard after terminal delete");
    if (guardAfterTerminalDelete.facial_imprint_synced) {
      fail("terminal delete cleanup", "guard sync state was not cleared after deleting the terminal");
    }
    const deletedTerminal = await request(`/api/terminals/${terminal.id}`);
    await expectStatus("deleted terminal lookup", deletedTerminal, 404);
    pass("terminal deletion cleans related guard face enrollment state");

    log("deleting guard, shift, and site");
    await requestJson(`/api/guards/${guard.id}`, { method: "DELETE" }, "delete guard");
    await requestJson(`/api/shifts/${shift.id}`, { method: "DELETE" }, "delete shift");
    await requestJson(`/api/sites/${site.id}`, { method: "DELETE" }, "delete site");

    const deletedSite = await request(`/api/sites/${site.id}`);
    await expectStatus("deleted site lookup", deletedSite, 404);
    pass("delete endpoints remove records");
  } finally {
    const cleanupPriority = {
      terminal: 0,
      guard: 1,
      shift: 2,
      site: 3
    };

    for (const target of [...cleanupTargets].sort(
      (left, right) => cleanupPriority[left.label] - cleanupPriority[right.label]
    )) {
      try {
        await deleteIfPresent(target.path);
      } catch (error) {
        console.warn(
          `cleanup warning for ${target.label}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    await new Promise((resolve) => fakeHikvision.server.close(resolve));
  }

  log("checking ingest protection");
  const ingestResponse = await fetch(new URL("/api/events/ingest", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      employee_no: "WS-001",
      terminal_id: "demo-terminal",
      event_type: "clock_in",
      event_time: new Date().toISOString()
    }),
    redirect: "manual"
  });
  await expectStatus("ingest protection", ingestResponse, 401);
  pass("event ingest rejects missing secret");

  log("checking ingest success with secret");
  const authorizedIngest = await fetch(new URL("/api/events/ingest", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingest-key": ingestSecret
    },
    body: JSON.stringify({
      employee_no: "WS-001",
      terminal_id: "smoke-terminal",
      event_type: "clock_in",
      event_time: new Date().toISOString()
    }),
    redirect: "manual"
  });
  await expectStatus("authorized ingest", authorizedIngest, 200);
  pass("event ingest accepts the configured secret");

  log("logging out");
  const logoutResponse = await request("/api/auth/logout", {
    method: "POST"
  });
  await expectStatus("logout", logoutResponse, 200);
  pass("logout succeeds");

  cookieHeader = "";
  await delay(0);

  log("confirming session cleared");
  const postLogoutDashboard = await request("/dashboard");
  await expectStatus("post-logout dashboard", postLogoutDashboard, [307, 308]);
  const postLogoutLocation = postLogoutDashboard.headers.get("location") || "";
  if (!postLogoutLocation.endsWith("/login")) {
    fail("post-logout dashboard", `expected /login, received ${postLogoutLocation}`);
  }
  pass("logout clears access to protected pages");

  console.log("Smoke checks completed successfully.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
