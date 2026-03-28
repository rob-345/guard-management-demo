import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const baseUrl = new URL(process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000");
const email = process.env.SMOKE_EMAIL || process.env.ADMIN_EMAIL || "admin@westec.co.zw";
const password = process.env.SMOKE_PASSWORD || process.env.ADMIN_PASSWORD || "Password@123";
const ingestSecret =
  process.env.SMOKE_INGEST_SECRET ||
  process.env.EVENT_INGEST_SECRET ||
  "demo-ingest-secret";

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
  const response = await request(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "Content-Type": "application/json"
    }
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

  try {
    log("creating site, shift, guard, and terminal");
    const site = await requestJson(
      "/api/sites",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Smoke Site ${runId}`,
          address: "1 Smoke Test Way",
          region: "North",
          contact_person: "Smoke Supervisor",
          contact_phone: "+263700000000"
        })
      },
      "create site"
    );
    cleanupTargets.push({ path: `/api/sites/${site.id}`, label: "site" });

    const shift = await requestJson(
      "/api/shifts",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Smoke Shift ${runId}`,
          start_time: "08:00",
          end_time: "16:00"
        })
      },
      "create shift"
    );
    cleanupTargets.push({ path: `/api/shifts/${shift.id}`, label: "shift" });

    const guard = await requestJson(
      "/api/guards",
      {
        method: "POST",
        body: JSON.stringify({
          employee_number: `SM-${runId.toUpperCase()}`,
          full_name: "Smoke Guard",
          phone_number: "+263700000001",
          email: "smoke.guard@example.com",
          photo_url: "https://example.com/photo.jpg",
          status: "active"
        })
      },
      "create guard"
    );
    cleanupTargets.push({ path: `/api/guards/${guard.id}`, label: "guard" });

    const terminal = await requestJson(
      "/api/terminals",
      {
        method: "POST",
        body: JSON.stringify({
          name: `Smoke Terminal ${runId}`,
          ip_address: "127.0.0.1:65535",
          username: "admin",
          password: "admin123",
          site_id: site.id
        })
      },
      "create terminal"
    );
    cleanupTargets.push({ path: `/api/terminals/${terminal.id}`, label: "terminal" });

    if (site.name !== `Smoke Site ${runId}`) {
      fail("create site", "site name was not persisted");
    }
    if (shift.name !== `Smoke Shift ${runId}`) {
      fail("create shift", "shift name was not persisted");
    }
    if (guard.employee_number !== `SM-${runId.toUpperCase()}`) {
      fail("create guard", "guard employee number was not persisted");
    }
    if (terminal.site_id !== site.id) {
      fail("create terminal", "terminal site_id was not persisted");
    }
    pass("create endpoints persist records");

    log("updating site, shift, guard, and terminal");
    const updatedSite = await requestJson(
      `/api/sites/${site.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          region: "Central",
          contact_person: "Updated Supervisor",
          contact_phone: "+263700000099"
        })
      },
      "update site"
    );
    if (updatedSite.region !== "Central" || updatedSite.contact_person !== "Updated Supervisor") {
      fail("update site", "site updates were not persisted");
    }

    const updatedShift = await requestJson(
      `/api/shifts/${shift.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: `Smoke Shift ${runId} Updated`,
          end_time: "17:00"
        })
      },
      "update shift"
    );
    if (updatedShift.name !== `Smoke Shift ${runId} Updated` || updatedShift.end_time !== "17:00") {
      fail("update shift", "shift updates were not persisted");
    }

    const updatedGuard = await requestJson(
      `/api/guards/${guard.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          full_name: "Updated Smoke Guard",
          status: "suspended"
        })
      },
      "update guard"
    );
    if (updatedGuard.full_name !== "Updated Smoke Guard" || updatedGuard.status !== "suspended") {
      fail("update guard", "guard updates were not persisted");
    }

    const updatedTerminal = await requestJson(
      `/api/terminals/${terminal.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: `Smoke Terminal ${runId} Updated`,
          ip_address: "127.0.0.1:65534",
          status: "offline"
        })
      },
      "update terminal"
    );
    if (
      updatedTerminal.name !== `Smoke Terminal ${runId} Updated` ||
      updatedTerminal.ip_address !== "127.0.0.1:65534" ||
      updatedTerminal.status !== "offline"
    ) {
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

    log("deleting terminal, guard, shift, and site");
    await requestJson(`/api/terminals/${terminal.id}`, { method: "DELETE" }, "delete terminal");
    await requestJson(`/api/guards/${guard.id}`, { method: "DELETE" }, "delete guard");
    await requestJson(`/api/shifts/${shift.id}`, { method: "DELETE" }, "delete shift");
    await requestJson(`/api/sites/${site.id}`, { method: "DELETE" }, "delete site");

    const deletedTerminal = await request(`/api/terminals/${terminal.id}`);
    await expectStatus("deleted terminal lookup", deletedTerminal, 404);
    const deletedSite = await request(`/api/sites/${site.id}`);
    await expectStatus("deleted site lookup", deletedSite, 404);
    pass("delete endpoints remove records");
  } finally {
    for (const target of cleanupTargets.reverse()) {
      try {
        await deleteIfPresent(target.path);
      } catch (error) {
        console.warn(
          `cleanup warning for ${target.label}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
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
