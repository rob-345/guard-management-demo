import type { HikvisionConsumeAlertStreamOptions } from "@guard-management/hikvision-isapi-sdk";

import { getCachedHikvisionClient } from "./hikvision";
import { getHikvisionTerminalGatewayConfig } from "./hikvision-terminal-gateway-config";
import { parseGatewayEventParts } from "./hikvision-terminal-gateway-parser";
import { bridgeGatewayEventToClockingIngest } from "./hikvision-terminal-gateway-shadow-bridge";
import { summarizeGatewayEvents } from "./hikvision-terminal-gateway-summary";
import type {
  HikvisionTerminalGatewayEvent,
  HikvisionTerminalGatewayStreamState,
  HikvisionTerminalGatewaySummary,
} from "./hikvision-terminal-gateway-types";
import type { Terminal } from "./types";

const INITIAL_RECONNECT_BACKOFF_MS = 1_000;
const MAX_RECONNECT_BACKOFF_MS = 30_000;

export type HikvisionTerminalGatewaySessionSnapshot = {
  terminal_id: string;
  terminal_name?: string;
  stream_state: HikvisionTerminalGatewayStreamState;
  connected: boolean;
  last_error?: string;
  last_event_at?: string;
  last_connected_at?: string;
  last_disconnected_at?: string;
  buffered_event_count: number;
  recent_events: HikvisionTerminalGatewayEvent[];
  summary: HikvisionTerminalGatewaySummary;
  active_subscriber_count: number;
  bridge_error_count: number;
  last_bridge_error?: string;
  last_bridge_error_at?: string;
};

export type HikvisionTerminalGatewaySessionSubscriber = (
  event: HikvisionTerminalGatewayEvent
) => void | Promise<void>;

export type HikvisionTerminalGatewaySessionDeps = {
  maxBufferedEvents: number;
  consumeAlertStream?: (options?: HikvisionConsumeAlertStreamOptions) => Promise<void>;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  shadowBridgeEnabled?: boolean;
  bridgeGatewayEventToClockingIngest?: typeof bridgeGatewayEventToClockingIngest;
};

export class HikvisionTerminalGatewaySession {
  private streamState: HikvisionTerminalGatewayStreamState = "idle";
  private recentEvents: HikvisionTerminalGatewayEvent[] = [];
  private subscribers = new Set<HikvisionTerminalGatewaySessionSubscriber>();
  private sequenceIndex = 0;
  private running = false;
  private loopPromise?: Promise<void>;
  private abortController?: AbortController;
  private lastError?: string;
  private lastEventAt?: string;
  private lastConnectedAt?: string;
  private lastDisconnectedAt?: string;
  private bridgeErrorCount = 0;
  private lastBridgeError?: string;
  private lastBridgeErrorAt?: string;
  private reconnectBackoffMs = INITIAL_RECONNECT_BACKOFF_MS;
  private readyResolved = false;
  private readyPromise: Promise<void>;
  private readonly now: () => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private resolveReady!: () => void;
  private cancelBackoffWait?: () => void;
  private readonly consumeAlertStream: (
    options?: HikvisionConsumeAlertStreamOptions
  ) => Promise<void>;
  private readonly shadowBridgeEnabled: boolean;
  private readonly bridgeGatewayEventToClockingIngest: typeof bridgeGatewayEventToClockingIngest;

  constructor(
    private readonly terminal: Terminal,
    private readonly deps: HikvisionTerminalGatewaySessionDeps
  ) {
    this.now = deps.now || (() => new Date().toISOString());
    this.sleep =
      deps.sleep ||
      ((ms) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms);
        }));
    this.consumeAlertStream =
      deps.consumeAlertStream ||
      ((options) => getCachedHikvisionClient(this.terminal).consumeAlertStream(options));
    this.shadowBridgeEnabled =
      deps.shadowBridgeEnabled ?? getHikvisionTerminalGatewayConfig().shadow_bridge_enabled;
    this.bridgeGatewayEventToClockingIngest =
      deps.bridgeGatewayEventToClockingIngest || bridgeGatewayEventToClockingIngest;
    this.readyPromise = Promise.resolve();
  }

  start() {
    if (this.running) {
      return this.snapshot();
    }

    this.running = true;
    this.createReadyCycle();
    if (this.streamState === "stopped") {
      this.streamState = "idle";
    }
    this.loopPromise = this.runLoop();
    return this.snapshot();
  }

  async stop() {
    this.running = false;
    this.abortController?.abort();
    this.cancelBackoffWait?.();

    try {
      await this.loopPromise;
    } catch {
      // The session stores the stream failure state in-memory; stop should remain best-effort.
    } finally {
      this.loopPromise = undefined;
      this.abortController = undefined;
      this.streamState = "stopped";
      if (this.lastConnectedAt) {
        this.lastDisconnectedAt = this.now();
      }
    }
  }

  subscribe(subscriber: HikvisionTerminalGatewaySessionSubscriber) {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  whenReady() {
    return this.readyPromise;
  }

  snapshot(): HikvisionTerminalGatewaySessionSnapshot {
    const recentEvents = [...this.recentEvents];
    return {
      terminal_id: this.terminal.id,
      terminal_name: this.terminal.name,
      stream_state: this.streamState,
      connected: this.streamState === "connected",
      last_error: this.lastError,
      last_event_at: this.lastEventAt,
      last_connected_at: this.lastConnectedAt,
      last_disconnected_at: this.lastDisconnectedAt,
      buffered_event_count: recentEvents.length,
      recent_events: recentEvents,
      summary: summarizeGatewayEvents(recentEvents),
      active_subscriber_count: this.subscribers.size,
      bridge_error_count: this.bridgeErrorCount,
      last_bridge_error: this.lastBridgeError,
      last_bridge_error_at: this.lastBridgeErrorAt,
    };
  }

  private async runLoop() {
    while (this.running) {
      const attemptConnectedAt = this.now();
      let sawParsedEvent = false;
      const hadHealthyConnection = Boolean(this.lastConnectedAt);

      this.streamState = hadHealthyConnection ? "reconnecting" : "connecting";
      this.abortController = new AbortController();

      try {
        await this.consumeAlertStream({
          signal: this.abortController.signal,
          onPart: async (part) => {
            const receivedAt = this.now();
            const events = parseGatewayEventParts({
              part,
              sequenceIndex: this.sequenceIndex,
              terminalId: this.terminal.id,
              terminalName: this.terminal.name,
              receivedAt,
            });

            this.sequenceIndex += events.length;
            if (events.length === 0) {
              return;
            }

            if (!sawParsedEvent) {
              this.streamState = "connected";
              this.lastConnectedAt = attemptConnectedAt;
              this.lastError = undefined;
              this.reconnectBackoffMs = INITIAL_RECONNECT_BACKOFF_MS;
              sawParsedEvent = true;
              this.resolveReadyOnce();
            }

            for (const event of events) {
              this.lastEventAt = event.timestamp || event.received_at;
              this.recentEvents.push(event);
              if (this.recentEvents.length > this.deps.maxBufferedEvents) {
                this.recentEvents.splice(
                  0,
                  this.recentEvents.length - this.deps.maxBufferedEvents
                );
              }

              this.notifySubscribers(event);
              if (this.shadowBridgeEnabled) {
                void this.bridgeGatewayEventToClockingIngest({
                  terminal: this.terminal,
                  gatewayEvent: event,
                  enabled: true,
                }).catch((error) => {
                  this.recordBridgeFailure(event, error);
                });
              }
            }
          },
        });

        if (!this.running) {
          break;
        }

        this.markDisconnected(
          "Alert stream ended unexpectedly",
          sawParsedEvent,
          hadHealthyConnection
        );
      } catch (error) {
        if (!this.running) {
          break;
        }

        this.markDisconnected(
          error instanceof Error ? error.message : "Gateway alert stream failed",
          sawParsedEvent,
          hadHealthyConnection
        );
      } finally {
        this.abortController = undefined;
      }

      if (!this.running) {
        break;
      }

      await this.waitForReconnectBackoff(this.reconnectBackoffMs);
      if (!this.running) {
        break;
      }
      this.reconnectBackoffMs = Math.min(
        this.reconnectBackoffMs * 2,
        MAX_RECONNECT_BACKOFF_MS
      );
    }
  }

  private markDisconnected(
    message: string,
    hadConnectedThisAttempt: boolean,
    hadHealthyConnection: boolean
  ) {
    this.lastError = message;
    if (hadConnectedThisAttempt || hadHealthyConnection) {
      this.lastDisconnectedAt = this.now();
    }
    this.streamState =
      hadConnectedThisAttempt || hadHealthyConnection ? "reconnecting" : "error";
  }

  private resolveReadyOnce() {
    if (this.readyResolved) {
      return;
    }

    this.readyResolved = true;
    this.resolveReady();
  }

  private createReadyCycle() {
    this.readyResolved = false;
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
  }

  private notifySubscribers(event: HikvisionTerminalGatewayEvent) {
    for (const subscriber of [...this.subscribers]) {
      try {
        Promise.resolve(subscriber(event)).catch(() => {
          this.subscribers.delete(subscriber);
        });
      } catch {
        this.subscribers.delete(subscriber);
      }
    }
  }

  private recordBridgeFailure(event: HikvisionTerminalGatewayEvent, error: unknown) {
    const message =
      error instanceof Error ? error.message : "Gateway shadow bridge failed";
    this.bridgeErrorCount += 1;
    this.lastBridgeError = message;
    this.lastBridgeErrorAt = this.now();
    console.error("[hikvision-terminal-gateway-shadow-bridge]", {
      terminal_id: this.terminal.id,
      terminal_name: this.terminal.name,
      sequence_index: event.sequence_index,
      event_family: event.event_family,
      description: event.description,
      error: message,
    });
  }

  private async waitForReconnectBackoff(ms: number) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) {
          return;
        }

        settled = true;
        if (this.cancelBackoffWait === settle) {
          this.cancelBackoffWait = undefined;
        }
        resolve();
      };

      this.cancelBackoffWait = settle;
      Promise.resolve(this.sleep(ms)).catch(() => undefined).finally(settle);
    });
  }
}
