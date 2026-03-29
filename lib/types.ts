// Database types for Guard Management Demo
export type GuardStatus = "active" | "suspended" | "on_leave";
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertType =
  | "missed_clock_in"
  | "unknown_face"
  | "possible_breach"
  | "absence"
  | "path_health_degraded"
  | "path_health_down";
export type ClockingEventType = "clock_in" | "clock_out" | "unknown" | "stranger";
export type AssignmentStatus = "active" | "replaced" | "completed";
export type TerminalStatus = "online" | "offline" | "error";
export type GuardFaceEnrollmentStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "removing"
  | "removed";
export type TerminalWebhookDeliverySource = "device_push" | "device_test";

export interface HikvisionDeviceInfo {
  deviceName?: string;
  deviceID?: string;
  deviceId?: string;
  serialNumber?: string;
  subSerialNumber?: string;
  macAddress?: string;
  model?: string;
  hardwareVersion?: string;
  firmwareVersion?: string;
  firmwareReleasedDate?: string;
  deviceType?: string;
  [key: string]: unknown;
}

export interface HikvisionHttpHostNotification {
  id?: string;
  url?: string;
  protocolType?: string;
  parameterFormatType?: string;
  addressingFormatType?: string;
  hostName?: string;
  ipAddress?: string;
  portNo?: number;
  userName?: string;
  password?: string;
  httpAuthenticationMethod?: string;
  checkResponseEnabled?: boolean;
  [key: string]: unknown;
}

export interface HikvisionAcsWorkStatus {
  doorLockStatus?: number[];
  doorStatus?: number[];
  magneticStatus?: number[];
  antiSneakStatus?: "open" | "close" | string;
  hostAntiDismantleStatus?: "open" | "close" | string;
  cardReaderOnlineStatus?: number[];
  cardReaderAntiDismantleStatus?: number[];
  cardReaderVerifyMode?: number[];
  cardNum?: number;
  netStatus?: string;
  interfaceStatusList?: Array<{ id?: number; netStatus?: string }>;
  sipStatus?: string;
  ezvizStatus?: string;
  voipStatus?: string;
  wifiStatus?: string;
  [key: string]: unknown;
}

export interface HikvisionCapabilitiesSnapshot {
  system?: Record<string, unknown>;
  accessControl?: Record<string, unknown>;
  userInfo?: Record<string, unknown>;
  fdLib?: Record<string, unknown>;
  faceRecognizeMode?: Record<string, unknown>;
  subscribeEvent?: Record<string, unknown>;
  httpHosts?: Record<string, unknown>;
  picture?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GuardPhotoMetadata {
  photo_file_id?: string;
  photo_filename?: string;
  photo_mime_type?: string;
  photo_size?: number;
}

export interface Guard {
  id: string;
  employee_number: string;
  full_name: string;
  phone_number: string;
  email?: string;
  photo_url?: string;
  photo_file_id?: string;
  photo_filename?: string;
  photo_mime_type?: string;
  photo_size?: number;
  facial_imprint_synced: boolean;
  status: GuardStatus;
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: string;
  name: string;
  address?: string;
  location?: string;
  region?: string;
  contact_person?: string;
  contact_phone?: string;
  latitude?: number;
  longitude?: number;
  created_at: string;
  updated_at?: string;
}

export interface Shift {
  id: string;
  name: string;
  start_time: string; // HH:mm:ss
  end_time: string;
  created_at: string;
  updated_at?: string;
}

export interface GuardAssignment {
  id: string;
  guard_id: string;
  site_id: string;
  shift_id: string;
  effective_date: string;
  end_date?: string;
  status: AssignmentStatus;
  created_at: string;
  // joined
  guard?: Guard;
  site?: Site;
  shift?: Shift;
}

export interface Terminal {
  id: string;
  edge_terminal_id: string;
  device_uid?: string;
  name: string;
  site_id: string;
  ip_address?: string;
  username?: string;
  password?: string;
  snapshot_stream_id?: string;
  status: TerminalStatus;
  last_seen?: string;
  activation_status?: "unknown" | "activated" | "not_activated" | "error";
  registered_face_count?: number;
  device_info?: HikvisionDeviceInfo;
  capability_snapshot?: HikvisionCapabilitiesSnapshot;
  acs_work_status?: HikvisionAcsWorkStatus;
  face_recognize_mode?: string;
  webhook_token?: string;
  webhook_host_id?: string;
  webhook_url?: string;
  webhook_status?: "unset" | "configured" | "testing" | "active" | "error";
  webhook_subscription_id?: string;
  webhook_subscription_status?: "unset" | "subscribed" | "unsubscribed" | "error";
  webhook_subscription_error?: string;
  webhook_upload_ctrl?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  // joined
  site?: Site;
}

export interface ClockingEvent {
  id: string;
  guard_id?: string;
  employee_no?: string;
  terminal_id: string;
  site_id: string;
  event_type: ClockingEventType;
  event_time: string;
  created_at: string;
  // joined
  guard?: Guard;
  terminal?: Terminal;
  site?: Site;
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  initials: string;
}

export interface GuardFaceEnrollment {
  id: string;
  guard_id: string;
  terminal_id: string;
  device_employee_no?: string;
  status: GuardFaceEnrollmentStatus;
  error?: string;
  created_at: string;
  updated_at: string;
  synced_at?: string;
  removed_at?: string;
}

export interface TerminalWebhookDelivery {
  id: string;
  terminal_id: string;
  source: TerminalWebhookDeliverySource;
  success: boolean;
  event_type?: string;
  employee_no?: string;
  clocking_event_id?: string;
  error?: string;
  payload_preview?: string;
  created_at: string;
}
