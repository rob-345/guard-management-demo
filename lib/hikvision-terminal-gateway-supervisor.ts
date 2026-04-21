import { getHikvisionTerminalGatewayConfig } from "./hikvision-terminal-gateway-config";
import {
  HikvisionTerminalGatewaySession,
  type HikvisionTerminalGatewaySessionSnapshot,
} from "./hikvision-terminal-gateway-session";
import { getCollection } from "./mongodb";
import type { Terminal } from "./types";

export const HIKVISION_TERMINAL_GATEWAY_REFRESH_INTERVAL_MS = 30_000;

export type HikvisionTerminalGatewaySessionLike = {
  start: () => unknown;
  stop: () => Promise<void> | void;
  subscribe: HikvisionTerminalGatewaySession["subscribe"];
  snapshot: () => HikvisionTerminalGatewaySessionSnapshot;
  whenReady: () => Promise<void>;
};

export type HikvisionTerminalGatewaySupervisorStatus = {
  enabled: boolean;
  running: boolean;
  started_at?: string;
  refresh_interval_ms: number;
  refresh_in_flight: boolean;
  last_refresh_at?: string;
  last_error?: string;
  terminal_count: number;
  eligible_terminal_count: number;
  session_count: number;
  connected_session_count: number;
  buffered_event_count: number;
  active_subscriber_count: number;
  terminals: HikvisionTerminalGatewayTerminalSnapshot[];
};

export type HikvisionTerminalGatewayTerminalSnapshot = {
  terminal_id: string;
  terminal_name?: string;
  eligible: boolean;
  session?: HikvisionTerminalGatewaySessionSnapshot;
};

export type HikvisionTerminalGatewaySupervisorDeps = {
  enabled?: boolean;
  refreshIntervalMs?: number;
  now?: () => string;
  loadTerminals?: () => Promise<Terminal[]>;
  createSession?: (terminal: Terminal) => HikvisionTerminalGatewaySessionLike;
};

type HikvisionTerminalGatewaySupervisorState = {
  startedAt?: string;
  timer?: ReturnType<typeof setInterval>;
  refreshPromise?: Promise<HikvisionTerminalGatewaySupervisorStatus>;
  initialRefreshSettled: boolean;
  lastRefreshAt?: string;
  lastError?: string;
  lastTerminalCount: number;
  lastEligibleTerminalCount: number;
  terminalsById: Map<string, Terminal>;
  sessionsById: Map<string, HikvisionTerminalGatewaySessionLike>;
  sessionConnectionKeysById: Map<string, string>;
};

declare global {
  var __guard_hikvision_terminal_gateway_supervisor:
    | ReturnType<typeof createHikvisionTerminalGatewaySupervisor>
    | undefined;
}

function isEligibleGatewayTerminal(terminal: Terminal) {
  return Boolean(terminal.ip_address && terminal.username && terminal.password);
}

function createState(): HikvisionTerminalGatewaySupervisorState {
  return {
    initialRefreshSettled: false,
    lastTerminalCount: 0,
    lastEligibleTerminalCount: 0,
    terminalsById: new Map(),
    sessionsById: new Map(),
    sessionConnectionKeysById: new Map(),
  };
}

function buildTerminalConnectionKey(terminal: Terminal) {
  return [terminal.ip_address || "", terminal.username || "", terminal.password || ""].join("|");
}

export function findGatewaySupervisorTerminalSnapshot(
  status: HikvisionTerminalGatewaySupervisorStatus,
  terminalId: string
) {
  return status.terminals.find((terminal) => terminal.terminal_id === terminalId);
}

export function formatGatewaySseEvent(event: string, payload: unknown) {
  const serialized = JSON.stringify(payload ?? null);
  return [`event: ${event}`, ...serialized.split("\n").map((line) => `data: ${line}`), "", ""].join(
    "\n"
  );
}

export function formatGatewaySseComment(comment?: string) {
  return comment ? `: ${comment}\n\n` : ":\n\n";
}

export function buildGatewaySseHeaders() {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

export function createHikvisionTerminalGatewaySupervisor(
  deps: HikvisionTerminalGatewaySupervisorDeps = {}
) {
  const config = getHikvisionTerminalGatewayConfig();
  const enabled = deps.enabled ?? config.enabled;
  const refreshIntervalMs =
    deps.refreshIntervalMs ?? HIKVISION_TERMINAL_GATEWAY_REFRESH_INTERVAL_MS;
  const now = deps.now || (() => new Date().toISOString());
  const loadTerminals =
    deps.loadTerminals ||
    (async () =>
      getCollection<Terminal>("terminals").then((collection) =>
        collection.find({}).sort({ name: 1 }).toArray()
      ));
  const createSession =
    deps.createSession ||
    ((terminal: Terminal) =>
      new HikvisionTerminalGatewaySession(terminal, {
        maxBufferedEvents: config.max_buffer_size,
      }));
  const state = createState();

  function summarizeStatus(): HikvisionTerminalGatewaySupervisorStatus {
    const terminals = [...state.terminalsById.values()].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
    const terminalEntries = terminals.map((terminal) => {
      const session = state.sessionsById.get(terminal.id);
      return {
        terminal_id: terminal.id,
        terminal_name: terminal.name,
        eligible: isEligibleGatewayTerminal(terminal),
        session: session?.snapshot(),
      };
    });
    const sessionSnapshots = [...state.sessionsById.values()].map((session) => session.snapshot());

    return {
      enabled,
      running: Boolean(enabled && state.timer),
      started_at: state.startedAt,
      refresh_interval_ms: refreshIntervalMs,
      refresh_in_flight: Boolean(state.refreshPromise),
      last_refresh_at: state.lastRefreshAt,
      last_error: state.lastError,
      terminal_count: state.lastTerminalCount,
      eligible_terminal_count: state.lastEligibleTerminalCount,
      session_count: sessionSnapshots.length,
      connected_session_count: sessionSnapshots.filter((session) => session.connected).length,
      buffered_event_count: sessionSnapshots.reduce(
        (total, session) => total + session.buffered_event_count,
        0
      ),
      active_subscriber_count: sessionSnapshots.reduce(
        (total, session) => total + session.active_subscriber_count,
        0
      ),
      terminals: terminalEntries,
    };
  }

  async function refreshNow() {
    if (!enabled) {
      state.initialRefreshSettled = true;
      return summarizeStatus();
    }

    if (state.refreshPromise) {
      return state.refreshPromise;
    }

    const promise = (async () => {
      const terminals = await loadTerminals();
      const eligibleTerminals = terminals.filter(isEligibleGatewayTerminal);
      const eligibleIds = new Set(eligibleTerminals.map((terminal) => terminal.id));

      state.terminalsById.clear();
      for (const terminal of terminals) {
        state.terminalsById.set(terminal.id, terminal);
      }
      state.lastTerminalCount = terminals.length;
      state.lastEligibleTerminalCount = eligibleTerminals.length;

      for (const terminal of eligibleTerminals) {
        const nextConnectionKey = buildTerminalConnectionKey(terminal);
        const existingSession = state.sessionsById.get(terminal.id);
        const existingConnectionKey = state.sessionConnectionKeysById.get(terminal.id);

        if (existingSession && existingConnectionKey !== nextConnectionKey) {
          await existingSession.stop();
          state.sessionsById.delete(terminal.id);
          state.sessionConnectionKeysById.delete(terminal.id);
        }

        if (!state.sessionsById.has(terminal.id)) {
          const session = createSession(terminal);
          state.sessionsById.set(terminal.id, session);
          state.sessionConnectionKeysById.set(terminal.id, nextConnectionKey);
          session.start();
        }
      }

      for (const [terminalId, session] of [...state.sessionsById.entries()]) {
        if (eligibleIds.has(terminalId)) {
          continue;
        }

        await session.stop();
        state.sessionsById.delete(terminalId);
        state.sessionConnectionKeysById.delete(terminalId);
      }

      state.lastRefreshAt = now();
      state.lastError = undefined;
      return summarizeStatus();
    })();

    state.refreshPromise = promise;

    try {
      return await promise;
    } catch (error) {
      state.lastRefreshAt = now();
      state.lastError =
        error instanceof Error
          ? error.message
          : "Failed to refresh Hikvision terminal gateway supervisor";
      return summarizeStatus();
    } finally {
      state.initialRefreshSettled = true;
      state.refreshPromise = undefined;
    }
  }

  function start() {
    if (!enabled) {
      state.initialRefreshSettled = true;
      return summarizeStatus();
    }

    if (!state.startedAt) {
      state.startedAt = now();
    }

    if (!state.timer) {
      state.timer = setInterval(() => {
        void refreshNow();
      }, refreshIntervalMs);
      state.timer.unref?.();
    }

    if (!state.initialRefreshSettled && !state.refreshPromise) {
      void refreshNow();
    }
    return summarizeStatus();
  }

  async function waitForInitialRefresh() {
    if (!enabled) {
      state.initialRefreshSettled = true;
      return summarizeStatus();
    }

    start();

    if (state.initialRefreshSettled) {
      return summarizeStatus();
    }

    if (state.refreshPromise) {
      return state.refreshPromise;
    }

    return refreshNow();
  }

  async function stop() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = undefined;
    }

    await Promise.all(
      [...state.sessionsById.values()].map((session) => Promise.resolve(session.stop()))
    );
    state.sessionsById.clear();
    state.sessionConnectionKeysById.clear();
    state.initialRefreshSettled = false;
  }

  return {
    start,
    stop,
    refreshNow,
    waitForInitialRefresh,
    getStatus: summarizeStatus,
    getSession(terminalId: string) {
      return state.sessionsById.get(terminalId);
    },
  };
}

const singletonSupervisor =
  globalThis.__guard_hikvision_terminal_gateway_supervisor ??
  (globalThis.__guard_hikvision_terminal_gateway_supervisor =
    createHikvisionTerminalGatewaySupervisor());

export function ensureHikvisionTerminalGateway() {
  return singletonSupervisor.start();
}

export async function waitForHikvisionTerminalGatewayInitialRefresh() {
  return singletonSupervisor.waitForInitialRefresh();
}

export function getHikvisionTerminalGatewayStatus() {
  return singletonSupervisor.getStatus();
}

export function getHikvisionTerminalGatewaySession(terminalId: string) {
  return singletonSupervisor.getSession(terminalId);
}

export async function refreshHikvisionTerminalGatewayNow() {
  singletonSupervisor.start();
  return singletonSupervisor.refreshNow();
}
