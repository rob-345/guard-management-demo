import {
  getTerminalSnapshotBufferSummary,
  scheduleTerminalSnapshotBufferCapture,
} from "./event-snapshots";
import { getCollection } from "./mongodb";
import { pollTerminalEvents } from "./terminal-event-polling";
import type { PollTerminalEventsResult } from "./terminal-event-polling";
import type { Terminal } from "./types";

export const TERMINAL_LIVE_MONITOR_EVENT_INTERVAL_MS = 1_000;
export const TERMINAL_LIVE_MONITOR_SNAPSHOT_INTERVAL_MS = 250;
const TERMINAL_LIVE_MONITOR_TERMINAL_CACHE_TTL_MS = 1_000;

export type TerminalLiveMonitorTerminalStatus = {
  terminal_id: string;
  terminal_name: string;
  heartbeat_status?: Terminal["heartbeat_status"];
  success?: boolean;
  error?: string;
  last_event_poll_at?: string;
  last_snapshot_captured_at?: string;
  frame_count?: number;
  fetched_count?: number;
  inserted_count?: number;
  duplicate_count?: number;
  updated_at: string;
};

export type TerminalLiveMonitorStatus = {
  running: boolean;
  started_at?: string;
  interval_seconds: number;
  snapshot_interval_ms: number;
  event_poll_in_flight: boolean;
  snapshot_cycle_in_flight: boolean;
  last_event_poll_at?: string;
  last_snapshot_cycle_at?: string;
  terminal_count: number;
  online_heartbeats: number;
  inserted_count: number;
  duplicate_count: number;
  fetched_count: number;
  buffered_terminals: number;
  last_error?: string;
  terminals: TerminalLiveMonitorTerminalStatus[];
};

type TerminalLiveMonitorState = {
  startedAt?: string;
  eventTimer?: ReturnType<typeof setInterval>;
  snapshotTimer?: ReturnType<typeof setInterval>;
  lastEventPollAt?: string;
  lastSnapshotCycleAt?: string;
  lastError?: string;
  eventPollPromise?: Promise<PollTerminalEventsResult[]>;
  snapshotCyclePromise?: Promise<TerminalLiveMonitorTerminalStatus[]>;
  terminalCacheLoadedAtMs?: number;
  terminalCache?: Terminal[];
  terminalsById: Map<string, TerminalLiveMonitorTerminalStatus>;
};

declare global {
  var __guard_terminal_live_monitor_state:
    | TerminalLiveMonitorState
    | undefined;
}

function createTerminalLiveMonitorState(): TerminalLiveMonitorState {
  return {
    terminalsById: new Map(),
  };
}

const terminalLiveMonitorState =
  globalThis.__guard_terminal_live_monitor_state ??
  (globalThis.__guard_terminal_live_monitor_state = createTerminalLiveMonitorState());

function isMonitorReadyTerminal(terminal: Terminal) {
  return Boolean(terminal.ip_address && terminal.username && terminal.password);
}

function summarizeMonitorStatus(): TerminalLiveMonitorStatus {
  const terminals = [...terminalLiveMonitorState.terminalsById.values()].sort((left, right) =>
    left.terminal_name.localeCompare(right.terminal_name)
  );

  return {
    running: Boolean(
      terminalLiveMonitorState.eventTimer && terminalLiveMonitorState.snapshotTimer
    ),
    started_at: terminalLiveMonitorState.startedAt,
    interval_seconds: TERMINAL_LIVE_MONITOR_EVENT_INTERVAL_MS / 1_000,
    snapshot_interval_ms: TERMINAL_LIVE_MONITOR_SNAPSHOT_INTERVAL_MS,
    event_poll_in_flight: Boolean(terminalLiveMonitorState.eventPollPromise),
    snapshot_cycle_in_flight: Boolean(terminalLiveMonitorState.snapshotCyclePromise),
    last_event_poll_at: terminalLiveMonitorState.lastEventPollAt,
    last_snapshot_cycle_at: terminalLiveMonitorState.lastSnapshotCycleAt,
    terminal_count: terminals.length,
    online_heartbeats: terminals.filter((terminal) => terminal.heartbeat_status === "online")
      .length,
    inserted_count: terminals.reduce(
      (total, terminal) => total + (terminal.inserted_count || 0),
      0
    ),
    duplicate_count: terminals.reduce(
      (total, terminal) => total + (terminal.duplicate_count || 0),
      0
    ),
    fetched_count: terminals.reduce(
      (total, terminal) => total + (terminal.fetched_count || 0),
      0
    ),
    buffered_terminals: terminals.filter((terminal) => (terminal.frame_count || 0) > 0).length,
    last_error: terminalLiveMonitorState.lastError,
    terminals,
  };
}

function upsertTerminalStatus(
  terminal: Pick<Terminal, "id" | "name">,
  patch: Partial<TerminalLiveMonitorTerminalStatus>
) {
  const existing = terminalLiveMonitorState.terminalsById.get(terminal.id);
  const next: TerminalLiveMonitorTerminalStatus = {
    ...existing,
    ...patch,
    terminal_id: terminal.id,
    terminal_name: terminal.name,
    updated_at: new Date().toISOString(),
  };

  terminalLiveMonitorState.terminalsById.set(terminal.id, next);
  return next;
}

async function loadMonitorTerminals(force = false) {
  const nowMs = Date.now();
  if (
    !force &&
    terminalLiveMonitorState.terminalCache &&
    terminalLiveMonitorState.terminalCacheLoadedAtMs &&
    nowMs - terminalLiveMonitorState.terminalCacheLoadedAtMs <
      TERMINAL_LIVE_MONITOR_TERMINAL_CACHE_TTL_MS
  ) {
    return terminalLiveMonitorState.terminalCache;
  }

  const terminals = await getCollection<Terminal>("terminals").then((collection) =>
    collection.find({}).sort({ name: 1 }).toArray()
  );
  const monitorReadyTerminals = terminals.filter(isMonitorReadyTerminal);
  const terminalIds = new Set(monitorReadyTerminals.map((terminal) => terminal.id));

  for (const terminalId of [...terminalLiveMonitorState.terminalsById.keys()]) {
    if (!terminalIds.has(terminalId)) {
      terminalLiveMonitorState.terminalsById.delete(terminalId);
    }
  }

  terminalLiveMonitorState.terminalCache = monitorReadyTerminals;
  terminalLiveMonitorState.terminalCacheLoadedAtMs = nowMs;

  for (const terminal of monitorReadyTerminals) {
    upsertTerminalStatus(terminal, {});
  }

  return monitorReadyTerminals;
}

async function runEventPollCycle() {
  if (terminalLiveMonitorState.eventPollPromise) {
    return terminalLiveMonitorState.eventPollPromise;
  }

  const promise = (async () => {
    const terminals = await loadMonitorTerminals(true);
    const settledResults = await Promise.allSettled(
      terminals.map(async (terminal: Terminal) => {
        try {
          const result = await pollTerminalEvents(terminal, {
            allEvents: true,
            captureSnapshotBuffer: false,
          });

          upsertTerminalStatus(terminal, {
            success: true,
            error: undefined,
            heartbeat_status: result.heartbeat.status,
            last_event_poll_at: new Date().toISOString(),
            fetched_count: result.fetched_count,
            inserted_count: result.inserted_count,
            duplicate_count: result.duplicate_count,
          });

          return result;
        } catch (error) {
          upsertTerminalStatus(terminal, {
            success: false,
            error:
              error instanceof Error ? error.message : "Failed to poll terminal events",
            last_event_poll_at: new Date().toISOString(),
          });
          return null;
        }
      })
    );

    const results = settledResults
      .flatMap((result: PromiseSettledResult<PollTerminalEventsResult | null>) =>
        result.status === "fulfilled" && result.value ? [result.value] : []
      );

    terminalLiveMonitorState.lastEventPollAt = new Date().toISOString();
    terminalLiveMonitorState.lastError = settledResults.some(
      (result: PromiseSettledResult<PollTerminalEventsResult | null>) =>
        result.status === "rejected" ||
        (result.status === "fulfilled" && result.value === null)
    )
      ? "One or more terminals failed during the last event poll"
      : undefined;
    return results;
  })();

  terminalLiveMonitorState.eventPollPromise = promise;

  try {
    return await promise;
  } catch (error) {
    terminalLiveMonitorState.lastEventPollAt = new Date().toISOString();
    terminalLiveMonitorState.lastError =
      error instanceof Error ? error.message : "Terminal event poll failed";
    return [];
  } finally {
    terminalLiveMonitorState.eventPollPromise = undefined;
  }
}

async function runSnapshotCycle() {
  if (terminalLiveMonitorState.snapshotCyclePromise) {
    return terminalLiveMonitorState.snapshotCyclePromise;
  }

  const promise = (async () => {
    const terminals = await loadMonitorTerminals();
    const results = terminals.map((terminal: Terminal) => {
      const scheduled = scheduleTerminalSnapshotBufferCapture(terminal);
      const summary = getTerminalSnapshotBufferSummary(terminal.id);

      return upsertTerminalStatus(terminal, {
        success: scheduled || summary.frame_count > 0,
        error: undefined,
        last_snapshot_captured_at: summary.latest_captured_at,
        frame_count: summary.frame_count,
      });
    });

    terminalLiveMonitorState.lastSnapshotCycleAt = new Date().toISOString();
    return results;
  })();

  terminalLiveMonitorState.snapshotCyclePromise = promise;

  try {
    return await promise;
  } catch (error) {
    terminalLiveMonitorState.lastSnapshotCycleAt = new Date().toISOString();
    terminalLiveMonitorState.lastError =
      error instanceof Error ? error.message : "Terminal snapshot cycle failed";
    return [];
  } finally {
    terminalLiveMonitorState.snapshotCyclePromise = undefined;
  }
}

export function ensureTerminalLiveMonitor() {
  if (!terminalLiveMonitorState.startedAt) {
    terminalLiveMonitorState.startedAt = new Date().toISOString();
  }

  if (!terminalLiveMonitorState.eventTimer) {
    terminalLiveMonitorState.eventTimer = setInterval(() => {
      void runEventPollCycle();
    }, TERMINAL_LIVE_MONITOR_EVENT_INTERVAL_MS);
  }

  if (!terminalLiveMonitorState.snapshotTimer) {
    terminalLiveMonitorState.snapshotTimer = setInterval(() => {
      void runSnapshotCycle();
    }, TERMINAL_LIVE_MONITOR_SNAPSHOT_INTERVAL_MS);
  }

  void runSnapshotCycle();
  void runEventPollCycle();

  return summarizeMonitorStatus();
}

export async function refreshTerminalLiveMonitorNow() {
  ensureTerminalLiveMonitor();
  await Promise.all([runSnapshotCycle(), runEventPollCycle()]);
  return summarizeMonitorStatus();
}

export function getTerminalLiveMonitorStatus() {
  return summarizeMonitorStatus();
}
