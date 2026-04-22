import assert from "node:assert/strict";
import test from "node:test";

import { getTerminalLiveMonitorStatus } from "./terminal-live-monitor";

test("live monitor status reports event polling fields only", () => {
  const state = globalThis.__guard_terminal_live_monitor_state;
  assert.ok(state, "expected live monitor state to be initialized");

  const original = {
    startedAt: state.startedAt,
    eventTimer: state.eventTimer,
    lastEventPollAt: state.lastEventPollAt,
    lastError: state.lastError,
    eventPollPromise: state.eventPollPromise,
    terminalCacheLoadedAtMs: state.terminalCacheLoadedAtMs,
    terminalCache: state.terminalCache,
    terminalsById: new Map(state.terminalsById),
  };

  try {
    state.startedAt = "2026-03-30T10:00:00.000Z";
    state.eventTimer = {} as ReturnType<typeof setInterval>;
    state.lastEventPollAt = "2026-03-30T10:00:02.000Z";
    state.lastError = undefined;
    state.eventPollPromise = undefined;
    state.terminalCacheLoadedAtMs = undefined;
    state.terminalCache = undefined;
    state.terminalsById = new Map([
      [
        "terminal-1",
        {
          terminal_id: "terminal-1",
          terminal_name: "Front Gate",
          heartbeat_status: "online",
          success: true,
          last_event_poll_at: "2026-03-30T10:00:02.000Z",
          fetched_count: 3,
          inserted_count: 2,
          duplicate_count: 1,
          updated_at: "2026-03-30T10:00:02.000Z",
        },
      ],
    ]);

    const status = getTerminalLiveMonitorStatus();

    assert.equal("snapshot_interval_ms" in status, false);
    assert.equal("snapshot_cycle_in_flight" in status, false);
    assert.equal("last_snapshot_cycle_at" in status, false);
    assert.equal("buffered_terminals" in status, false);
    assert.equal(status.running, true);
    assert.equal(status.terminals.length, 1);
    assert.equal("last_snapshot_captured_at" in status.terminals[0], false);
    assert.equal("frame_count" in status.terminals[0], false);
  } finally {
    state.startedAt = original.startedAt;
    state.eventTimer = original.eventTimer;
    state.lastEventPollAt = original.lastEventPollAt;
    state.lastError = original.lastError;
    state.eventPollPromise = original.eventPollPromise;
    state.terminalCacheLoadedAtMs = original.terminalCacheLoadedAtMs;
    state.terminalCache = original.terminalCache;
    state.terminalsById = original.terminalsById;
  }
});
