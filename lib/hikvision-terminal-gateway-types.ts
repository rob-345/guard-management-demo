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
};

export type HikvisionTerminalGatewayCaptureRecord = {
  metadata: HikvisionTerminalGatewayCaptureMetadata;
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
