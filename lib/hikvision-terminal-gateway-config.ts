import path from "node:path";

import type { HikvisionTerminalGatewayConfig } from "./hikvision-terminal-gateway-types";

export const DEFAULT_HIKVISION_TERMINAL_GATEWAY_MAX_BUFFER_SIZE = 250;

export function parseGatewayBoolean(value: string | undefined, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function parseGatewayInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getHikvisionTerminalGatewayConfig(
  env: NodeJS.ProcessEnv = process.env
): HikvisionTerminalGatewayConfig {
  return {
    enabled: parseGatewayBoolean(env.HIKVISION_TERMINAL_GATEWAY_ENABLED, false),
    max_buffer_size: parseGatewayInteger(
      env.HIKVISION_TERMINAL_GATEWAY_MAX_BUFFER_SIZE,
      DEFAULT_HIKVISION_TERMINAL_GATEWAY_MAX_BUFFER_SIZE
    ),
    capture_directory:
      env.HIKVISION_TERMINAL_GATEWAY_CAPTURE_DIR ||
      path.join(process.cwd(), ".captures", "hikvision-terminal-gateway"),
    shadow_bridge_enabled: parseGatewayBoolean(
      env.HIKVISION_TERMINAL_GATEWAY_SHADOW_BRIDGE_ENABLED,
      false
    ),
  };
}
