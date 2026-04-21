import type { HikvisionAlertStreamPart } from "@guard-management/hikvision-isapi-sdk";

export type HikvisionTerminalGatewayMultipartMetadata = {
  headers: Record<string, string>;
  content_type?: string;
  content_disposition?: string;
  part_name?: string;
  byte_length: number;
  raw_text: string;
  source_timestamp?: string;
};

export type HikvisionTerminalGatewayEvent = {
  sequence_index: number;
  terminal_id: string;
  terminal_name?: string;
  timestamp?: string;
  received_at: string;
  event_family: string;
  description: string;
  major_event_type?: string;
  sub_event_type?: string;
  event_state?: string;
  device_identifier?: string;
  terminal_identifier?: string;
  raw_payload: unknown;
  nested_payload?: Record<string, unknown>;
  multipart: HikvisionTerminalGatewayMultipartMetadata;
  parse_warnings: string[];
};

export type HikvisionTerminalGatewayStreamState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "stopped";

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
};

export type ParseGatewayEventPartInput = {
  part: HikvisionAlertStreamPart;
  sequenceIndex: number;
  terminalId: string;
  terminalName?: string;
  receivedAt?: string;
};

export type HikvisionTerminalGatewaySignatureSummary = {
  signature: string;
  count: number;
  latest_timestamp?: string;
  example_description: string;
};

export type HikvisionTerminalGatewaySummary = {
  total_events: number;
  warning_event_count: number;
  chronology: HikvisionTerminalGatewayEvent[];
  unique_signatures: HikvisionTerminalGatewaySignatureSummary[];
};

export type HikvisionTerminalGatewayCapturePaths = {
  directory: string;
  metadata_path: string;
  response_headers_path: string;
  raw_multipart_path: string;
  multipart_parts_path: string;
  events_path: string;
  summary_path: string;
};

export type HikvisionTerminalGatewayCaptureMetadata = {
  capture_id: string;
  terminal_id: string;
  terminal_name?: string;
  started_at: string;
  finished_at?: string;
  part_count: number;
  bytes_captured: number;
  response_content_type?: string;
};

export type HikvisionTerminalGatewayRawCapture = {
  response_headers: Record<string, string>;
  raw_multipart_body_text: string;
};

export type HikvisionTerminalGatewayCapturedMultipartPart = {
  headers: Record<string, string>;
  byte_length: number;
  raw_text: string;
  source_timestamp?: string;
};

export type HikvisionTerminalGatewayCaptureRecord = {
  metadata: HikvisionTerminalGatewayCaptureMetadata;
  raw_capture: HikvisionTerminalGatewayRawCapture;
  multipart_parts: HikvisionTerminalGatewayCapturedMultipartPart[];
  events: HikvisionTerminalGatewayEvent[];
  summary_markdown: string;
  paths: HikvisionTerminalGatewayCapturePaths;
};

export type HikvisionTerminalGatewayConfig = {
  enabled: boolean;
  max_buffer_size: number;
  capture_directory: string;
  shadow_bridge_enabled: boolean;
};
