// Database types for Guard Management Demo
export type GuardStatus = "active" | "suspended" | "on_leave";
export type GuardPersonType = "normal" | "visitor" | "blackList";
export type GuardPersonRole = "Guard" | "Supervisor" | "Manager";
export type GuardGender = "male" | "female" | "unknown";
export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertType =
  | "missed_clock_in"
  | "unknown_face"
  | "possible_breach"
  | "absence"
  | "path_health_degraded"
  | "path_health_down";
export type ClockingEventType =
  | "clocking"
  | "unknown"
  | "clock_in"
  | "clock_out"
  | "stranger";
export type ClockingEventOutcome = "valid" | "invalid" | "unauthorized" | "unknown";
export type ClockingEventSource =
  | "terminal_poll"
  | "shared_ingest"
  | "terminal_gateway";
export type AssignmentStatus = "active" | "replaced" | "completed";
export type AssignmentSyncStatus = "ok" | "partial" | "failed" | "not_required";
export type TerminalStatus = "online" | "offline" | "error";
export type ShiftSlot = "day" | "night";
export type AttendanceCheckStatus =
  | "awaiting_first_check_in"
  | "checked_in"
  | "overdue"
  | "completed";
export type ShiftAttendanceCheckInStatus = "valid" | "invalid";
export type ShiftAttendanceInvalidReason =
  | "outside_window"
  | "authentication_failed"
  | "unauthorized"
  | "duplicate_window";
export type AlertStatus = "open" | "resolved";
export type GuardFaceEnrollmentStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "removing"
  | "removed";
export type GuardTerminalValidationStatus =
  | "verified"
  | "face_missing"
  | "user_missing"
  | "details_mismatch"
  | "terminal_unreachable"
  | "validation_error";

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
  acsEvents?: Record<string, unknown>;
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
  person_type: GuardPersonType;
  person_role: GuardPersonRole;
  gender: GuardGender;
  photo_url?: string;
  photo_file_id?: string;
  photo_filename?: string;
  photo_mime_type?: string;
  photo_size?: number;
  facial_imprint_synced: boolean;
  has_terminal_enrollment?: boolean;
  terminal_validation?: GuardTerminalValidationSummary;
  current_assignment?: GuardAssignment;
  status: GuardStatus;
  created_at: string;
  updated_at: string;
}

export interface GuardTerminalValidation {
  terminal_id: string;
  terminal_name?: string;
  terminal_ip_address?: string;
  status: GuardTerminalValidationStatus;
  face_present: boolean;
  user_present: boolean;
  details_match: boolean;
  access_ready: boolean;
  error?: string;
  employee_no?: string;
  mismatches?: string[];
  validated_at: string;
}

export interface GuardTerminalValidationSummary {
  verified_count: number;
  total_terminals: number;
  unknown_count: number;
  failed_count: number;
  validations: GuardTerminalValidation[];
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

export interface SiteShiftBlock {
  start_time: string; // HH:mm:ss
  end_time: string;
  attendance_interval_minutes: number;
}

export interface SiteShiftSchedule {
  id: string;
  site_id: string;
  day_shift: SiteShiftBlock;
  night_shift?: SiteShiftBlock | null;
  created_at: string;
  updated_at?: string;
  // joined
  site?: Site;
}

export interface AssignmentTerminalSyncSummary {
  status: AssignmentSyncStatus;
  previous_terminal_count: number;
  target_terminal_count: number;
  removed_count: number;
  removal_failed_count: number;
  synced_count: number;
  sync_failed_count: number;
  updated_at: string;
}

export interface GuardAssignment {
  id: string;
  guard_id: string;
  site_id: string;
  shift_slot: ShiftSlot;
  effective_date: string;
  end_date?: string;
  status: AssignmentStatus;
  terminal_sync?: AssignmentTerminalSyncSummary;
  created_at: string;
  updated_at?: string;
  // joined
  guard?: Guard;
  site?: Site;
  site_shift_schedule?: SiteShiftSchedule;
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
  heartbeat_status?: "online" | "offline" | "error";
  heartbeat_checked_at?: string;
  activation_status?: "unknown" | "activated" | "not_activated" | "error";
  registered_face_count?: number;
  device_info?: HikvisionDeviceInfo;
  capability_snapshot?: HikvisionCapabilitiesSnapshot;
  acs_work_status?: HikvisionAcsWorkStatus;
  acs_event_time_filters_supported?: boolean;
  acs_event_time_filters_checked_at?: string;
  face_recognize_mode?: string;
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
  clocking_outcome?: ClockingEventOutcome;
  attendance_status?: string;
  event_source?: ClockingEventSource;
  raw_event_type?: string;
  event_state?: string;
  event_description?: string;
  major?: string;
  minor?: string;
  device_identifier?: string;
  terminal_identifier?: string;
  event_key?: string;
  snapshot_file_id?: string;
  snapshot_filename?: string;
  snapshot_mime_type?: string;
  snapshot_size?: number;
  snapshot_captured_at?: string;
  event_time: string;
  created_at: string;
  // joined
  guard?: Guard;
  terminal?: Terminal;
  site?: Site;
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  guard_id?: string;
  site_id?: string;
  assignment_id?: string;
  shift_slot?: ShiftSlot;
  expected_check_in_at?: string;
  last_clock_in_at?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
  // joined
  guard?: Guard;
  site?: Site;
  assignment?: GuardAssignment;
}

export interface ShiftAttendanceRow {
  assignment_id: string;
  guard_id: string;
  site_id: string;
  shift_slot: ShiftSlot;
  status: AttendanceCheckStatus;
  shift_start_at: string;
  shift_end_at: string;
  attendance_interval_minutes: number;
  last_valid_clock_in_at?: string;
  next_expected_clock_in_at?: string;
  overdue_by_minutes?: number;
  valid_check_in_count: number;
  invalid_check_in_count: number;
  check_ins: ShiftAttendanceCheckIn[];
  guard?: Guard;
  site?: Site;
  assignment?: GuardAssignment;
  open_alert?: Alert;
}

export interface ShiftAttendanceCheckIn {
  id: string;
  event_id: string;
  status: ShiftAttendanceCheckInStatus;
  recorded_at: string;
  expected_check_in_at?: string;
  deviation_minutes?: number;
  invalid_reason?: ShiftAttendanceInvalidReason;
  clocking_outcome?: ClockingEventOutcome;
  event_description?: string;
  snapshot_file_id?: string;
  snapshot_captured_at?: string;
}

export interface ShiftAttendanceGroup {
  site_id: string;
  shift_slot: ShiftSlot;
  schedule: SiteShiftBlock;
  window_start_at: string;
  window_end_at: string;
  is_active: boolean;
  site?: Site;
  rows: ShiftAttendanceRow[];
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
  last_verified_at?: string;
  last_verified_state?: GuardTerminalValidationStatus;
  last_validation_error?: string;
  created_at: string;
  updated_at: string;
  synced_at?: string;
  removed_at?: string;
}
