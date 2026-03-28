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

export interface Guard {
  id: string;
  employee_number: string;
  full_name: string;
  phone_number: string;
  email?: string;
  photo_url?: string;
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
  name: string;
  site_id: string;
  ip_address?: string;
  username?: string;
  password?: string;
  status: TerminalStatus;
  last_seen?: string;
  activation_status?: "unknown" | "activated" | "not_activated" | "error";
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
