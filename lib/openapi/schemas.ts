import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const errorResponseSchema = z.object({
  error: z.string(),
});

export const successResponseSchema = z.object({
  success: z.boolean(),
});

export const authLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const guardSchema = z.object({
  id: z.string(),
  employee_number: z.string(),
  full_name: z.string(),
  phone_number: z.string(),
  email: z.string().optional(),
  person_type: z.enum(["normal", "visitor", "blackList"]),
  person_role: z.enum(["Guard", "Supervisor", "Manager"]),
  gender: z.enum(["male", "female", "unknown"]),
  photo_url: z.string().optional(),
  photo_file_id: z.string().optional(),
  photo_filename: z.string().optional(),
  photo_mime_type: z.string().optional(),
  photo_size: z.number().optional(),
  facial_imprint_synced: z.boolean(),
  has_terminal_enrollment: z.boolean().optional(),
  terminal_validation: z
    .object({
      verified_count: z.number(),
      total_terminals: z.number(),
      unknown_count: z.number(),
      failed_count: z.number(),
      validations: z.array(
        z.object({
          terminal_id: z.string(),
          terminal_name: z.string().optional(),
          terminal_ip_address: z.string().optional(),
          status: z.enum([
            "verified",
            "face_missing",
            "user_missing",
            "details_mismatch",
            "terminal_unreachable",
            "validation_error",
          ]),
          face_present: z.boolean(),
          user_present: z.boolean(),
          details_match: z.boolean(),
          access_ready: z.boolean(),
          error: z.string().optional(),
          employee_no: z.string().optional(),
          mismatches: z.array(z.string()).optional(),
          validated_at: z.string(),
        })
      ),
    })
    .optional(),
  status: z.enum(["active", "suspended", "on_leave"]),
  created_at: z.string(),
  updated_at: z.string(),
  current_assignment: z.lazy(() => guardAssignmentSchema).optional(),
});

export const guardMultipartSchema = z.object({
  employee_number: z.string().min(1),
  full_name: z.string().min(2),
  phone_number: z.string().min(9),
  email: z.string().email().optional().or(z.literal("")),
  person_type: z.enum(["normal", "visitor", "blackList"]).optional(),
  person_role: z.enum(["Guard", "Supervisor", "Manager"]).optional(),
  gender: z.enum(["male", "female", "unknown"]).optional(),
  status: z.enum(["active", "suspended", "on_leave"]).optional(),
  photo_url: z.string().optional().or(z.literal("")),
  photo_file: z.any().optional().openapi({
    type: "string",
    format: "binary",
  }),
});

export const guardUpdateMultipartSchema = guardMultipartSchema
  .partial()
  .extend({
    remove_photo: z.boolean().optional(),
  });

export const siteSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().optional(),
  region: z.string().optional(),
  contact_person: z.string().optional(),
  contact_phone: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

export const siteInputSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional().or(z.literal("")),
  region: z.string().optional().or(z.literal("")),
  contact_person: z.string().optional().or(z.literal("")),
  contact_phone: z.string().optional().or(z.literal("")),
  latitude: z.union([z.number(), z.string()]).optional(),
  longitude: z.union([z.number(), z.string()]).optional(),
});

export const shiftBlockSchema = z.object({
  start_time: z.string(),
  end_time: z.string(),
  attendance_interval_minutes: z.number().int().min(1),
});

export const shiftBlockInputSchema = z.object({
  start_time: z.string(),
  end_time: z.string(),
  attendance_interval_minutes: z.union([z.number(), z.string()]).optional(),
});

export const shiftSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  day_shift: shiftBlockSchema,
  night_shift: shiftBlockSchema.nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  site: z.lazy(() => siteSchema).optional(),
});

export const shiftInputSchema = z.object({
  site_id: z.string().min(1),
  day_shift: shiftBlockInputSchema,
  night_shift: shiftBlockInputSchema.nullish(),
});

export const guardAssignmentSyncSummarySchema = z.object({
  status: z.enum(["ok", "partial", "failed", "not_required"]),
  previous_terminal_count: z.number(),
  target_terminal_count: z.number(),
  removed_count: z.number(),
  removal_failed_count: z.number(),
  synced_count: z.number(),
  sync_failed_count: z.number(),
  updated_at: z.string(),
});

export const guardAssignmentSchema = z.object({
  id: z.string(),
  guard_id: z.string(),
  site_id: z.string(),
  shift_slot: z.enum(["day", "night"]),
  effective_date: z.string(),
  end_date: z.string().optional(),
  status: z.enum(["active", "replaced", "completed"]),
  terminal_sync: guardAssignmentSyncSummarySchema.optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  site: z.lazy(() => siteSchema).optional(),
  site_shift_schedule: z.lazy(() => shiftSchema).optional(),
});

export const alertSchema = z.object({
  id: z.string(),
  type: z.enum([
    "missed_clock_in",
    "unknown_face",
    "possible_breach",
    "absence",
    "path_health_degraded",
    "path_health_down",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "resolved"]),
  title: z.string(),
  message: z.string(),
  guard_id: z.string().optional(),
  site_id: z.string().optional(),
  assignment_id: z.string().optional(),
  shift_slot: z.enum(["day", "night"]).optional(),
  expected_check_in_at: z.string().optional(),
  last_clock_in_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  resolved_at: z.string().optional(),
});

export const shiftAttendanceCheckInSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  status: z.enum(["valid", "invalid"]),
  recorded_at: z.string(),
  expected_check_in_at: z.string().optional(),
  deviation_minutes: z.number().optional(),
  invalid_reason: z
    .enum([
      "outside_window",
      "authentication_failed",
      "unauthorized",
      "duplicate_window",
    ])
    .optional(),
  clocking_outcome: z
    .enum(["valid", "invalid", "unauthorized", "unknown"])
    .optional(),
  event_description: z.string().optional(),
  snapshot_file_id: z.string().optional(),
  snapshot_captured_at: z.string().optional(),
});

export const shiftAttendanceRowSchema = z.object({
  assignment_id: z.string(),
  guard_id: z.string(),
  site_id: z.string(),
  shift_slot: z.enum(["day", "night"]),
  status: z.enum([
    "awaiting_first_check_in",
    "checked_in",
    "overdue",
    "completed",
  ]),
  shift_start_at: z.string(),
  shift_end_at: z.string(),
  attendance_interval_minutes: z.number(),
  last_valid_clock_in_at: z.string().optional(),
  next_expected_clock_in_at: z.string().optional(),
  overdue_by_minutes: z.number().optional(),
  valid_check_in_count: z.number(),
  invalid_check_in_count: z.number(),
  check_ins: z.array(shiftAttendanceCheckInSchema),
  guard: z.lazy(() => guardSchema).optional(),
  site: z.lazy(() => siteSchema).optional(),
  assignment: z.lazy(() => guardAssignmentSchema).optional(),
  open_alert: alertSchema.optional(),
});

export const shiftAttendanceGroupSchema = z.object({
  site_id: z.string(),
  shift_slot: z.enum(["day", "night"]),
  schedule: shiftBlockSchema,
  window_start_at: z.string(),
  window_end_at: z.string(),
  is_active: z.boolean(),
  site: z.lazy(() => siteSchema).optional(),
  rows: z.array(shiftAttendanceRowSchema),
});

export const shiftAttendanceResponseSchema = z.object({
  generated_at: z.string(),
  groups: z.array(shiftAttendanceGroupSchema),
});

export const terminalSchema = z.object({
  id: z.string(),
  edge_terminal_id: z.string(),
  device_uid: z.string().optional(),
  name: z.string(),
  site_id: z.string(),
  ip_address: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  snapshot_stream_id: z.string().optional(),
  status: z.enum(["online", "offline", "error"]),
  last_seen: z.string().optional(),
  activation_status: z.enum(["unknown", "activated", "not_activated", "error"]).optional(),
  registered_face_count: z.number().optional(),
  device_info: z.record(z.any()).optional(),
  capability_snapshot: z.record(z.any()).optional(),
  acs_work_status: z.record(z.any()).optional(),
  acs_event_time_filters_supported: z.boolean().optional(),
  acs_event_time_filters_checked_at: z.string().optional(),
  heartbeat_status: z.enum(["online", "offline", "error"]).optional(),
  heartbeat_checked_at: z.string().optional(),
  face_recognize_mode: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

export const terminalCreateSchema = z.object({
  name: z.string().min(1),
  ip_address: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  site_id: z.string().min(1),
  snapshot_stream_id: z.string().min(1).optional(),
});

export const terminalUpdateSchema = terminalCreateSchema
  .partial()
  .extend({
    status: z.enum(["online", "offline", "error"]).optional(),
    activation_status: z.enum(["unknown", "activated", "not_activated", "error"]).optional(),
    last_seen: z.string().optional(),
    device_uid: z.string().optional(),
    device_info: z.record(z.any()).optional(),
    capability_snapshot: z.record(z.any()).optional(),
    acs_work_status: z.record(z.any()).optional(),
    acs_event_time_filters_supported: z.boolean().optional(),
    acs_event_time_filters_checked_at: z.string().optional(),
    heartbeat_status: z.enum(["online", "offline", "error"]).optional(),
    heartbeat_checked_at: z.string().optional(),
    face_recognize_mode: z.string().optional(),
  });

export const terminalEventPollSchema = z.object({
  allEvents: z.boolean().optional(),
  major: z.union([z.number(), z.string()]).optional(),
  minors: z
    .union([
      z.array(z.union([z.number(), z.string()])),
      z.number(),
      z.string(),
    ])
    .optional(),
  minor: z.union([z.number(), z.string()]).optional(),
  maxResults: z.union([z.number(), z.string()]).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

export const faceSyncSchema = z.object({
  terminal_ids: z.array(z.string().min(1)).min(1),
  force: z.boolean().optional(),
});

export const faceRemoveSchema = z.object({
  terminal_ids: z.array(z.string().min(1)).min(1),
});

const hikvisionFaceRecordBaseSchema = z
  .object({
    fdid: z.string().min(1),
    faceLibType: z.string().min(1),
    faceUrl: z.string().url().optional(),
    modelData: z.string().optional(),
    fpid: z.string().optional(),
    name: z.string().optional(),
    employeeNo: z.string().optional(),
    extraFields: z.record(z.any()).optional(),
  });

export const hikvisionFaceRecordSchema = hikvisionFaceRecordBaseSchema.refine(
  (value) => Boolean(value.faceUrl || value.modelData),
  {
    message: "faceUrl or modelData is required",
  }
);

export const hikvisionFaceSearchSchema = z.object({
  fdid: z.string().min(1),
  faceLibType: z.string().min(1),
  fpid: z.string().optional(),
  name: z.string().optional(),
  certificateNumber: z.string().optional(),
  isInLibrary: z.string().optional(),
  maxResults: z.number().int().positive().max(1000).optional(),
  searchResultPosition: z.number().int().min(0).optional(),
});

export const hikvisionFullWorkflowSchema = hikvisionFaceRecordBaseSchema.extend({
  terminalNo: z.string().optional(),
}).refine((value) => Boolean(value.faceUrl || value.modelData), {
  message: "faceUrl or modelData is required",
});

export const terminalDiagnosticEventSchema = z.object({
  event_type: z.enum(["clocking", "clock_in", "clock_out", "unknown", "stranger"]),
  clocking_outcome: z.enum(["valid", "invalid", "unauthorized", "unknown"]).optional(),
  attendance_status: z.string().optional(),
  raw_event_type: z.string().optional(),
  employee_no: z.string().optional(),
  event_time: z.string().optional(),
  event_state: z.string().optional(),
  event_description: z.string().optional(),
  device_identifier: z.string().optional(),
  terminal_identifier: z.string().optional(),
  major: z.string().optional(),
  minor: z.string().optional(),
  normalized_event: z.record(z.any()),
});

const terminalEventQueryPlanSchema = z.object({
  major: z.number(),
  minors: z.array(z.number()),
});

const terminalEventMinorSetSchema = z.object({
  major: z.number(),
  minors: z.array(z.number()),
});

const terminalEventSearchErrorSchema = z.object({
  major: z.number(),
  minor: z.number(),
  error: z.string(),
});

export const terminalEventHistoryResponseSchema = z.object({
  success: z.boolean(),
  capabilities: z.record(z.any()).optional(),
  source: z.enum(["acsEvent", "alertStream"]).optional(),
  warning: z.string().optional(),
  terminal_events: z.array(terminalDiagnosticEventSchema),
  total_matches: z.number().optional(),
  search_result_position: z.number().optional(),
  max_results: z.number().optional(),
  poll_filters: z
    .object({
      all_events: z.boolean().optional(),
      major: z.number().optional(),
      minors: z.array(z.number()).optional(),
      maxResults: z.number().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      plans: z.array(terminalEventQueryPlanSchema).optional(),
    })
    .optional(),
  supported_minors_by_major: z.array(terminalEventMinorSetSchema).optional(),
  filtered_out_minors_by_major: z.array(terminalEventMinorSetSchema).optional(),
  search_errors: z.array(terminalEventSearchErrorSchema).optional(),
  raw_response: z.record(z.any()).optional(),
});

export const terminalAlertStreamResponseSchema = z.object({
  success: z.boolean(),
  content_type: z.string(),
  sample_text: z.string(),
  sample_bytes: z.number(),
  truncated: z.boolean(),
  events: z.array(terminalDiagnosticEventSchema),
  raw_headers: z.record(z.string()),
});

export const terminalEventDiagnosticsResponseSchema = z.object({
  success: z.boolean(),
  runtime_database: z.object({
    database_name: z.string().optional(),
    mongo_host: z.string().optional(),
    terminal_record_found: z.boolean().optional(),
    terminal_collection_count: z.number().optional(),
    clocking_event_collection_count: z.number().optional(),
    warning: z.string().optional(),
  }),
  terminal_history_error: z.string().optional(),
  terminal_history_source: z.enum(["acsEvent", "alertStream"]).optional(),
  capabilities: z.record(z.any()).optional(),
  recent_terminal_events: z.array(terminalDiagnosticEventSchema),
  recent_clocking_events: z.array(z.lazy(() => clockingEventSchema)),
  summary: z.object({
    status: z.enum(["healthy", "no_terminal_events", "storage_missing", "partial_match"]),
    message: z.string(),
    terminal_generated_count: z.number(),
    stored_clocking_count: z.number(),
    matched_terminal_to_clocking: z.number(),
  }),
  raw_terminal_response: z.record(z.any()).optional(),
});

export const clockingEventSchema = z.object({
  id: z.string(),
  guard_id: z.string().optional(),
  employee_no: z.string().optional(),
  terminal_id: z.string(),
  site_id: z.string(),
  event_type: z.enum(["clocking", "clock_in", "clock_out", "unknown", "stranger"]),
  clocking_outcome: z.enum(["valid", "invalid", "unauthorized", "unknown"]).optional(),
  attendance_status: z.string().optional(),
  event_source: z.enum(["terminal_poll", "shared_ingest"]).optional(),
  raw_event_type: z.string().optional(),
  event_state: z.string().optional(),
  event_description: z.string().optional(),
  major: z.string().optional(),
  minor: z.string().optional(),
  device_identifier: z.string().optional(),
  terminal_identifier: z.string().optional(),
  event_key: z.string().optional(),
  snapshot_file_id: z.string().optional(),
  snapshot_filename: z.string().optional(),
  snapshot_mime_type: z.string().optional(),
  snapshot_size: z.number().optional(),
  snapshot_captured_at: z.string().optional(),
  event_time: z.string(),
  created_at: z.string(),
});
