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
  photo_url: z.string().optional(),
  photo_file_id: z.string().optional(),
  photo_filename: z.string().optional(),
  photo_mime_type: z.string().optional(),
  photo_size: z.number().optional(),
  facial_imprint_synced: z.boolean(),
  status: z.enum(["active", "suspended", "on_leave"]),
  created_at: z.string(),
  updated_at: z.string(),
});

export const guardMultipartSchema = z.object({
  employee_number: z.string().min(1),
  full_name: z.string().min(2),
  phone_number: z.string().min(9),
  email: z.string().email().optional().or(z.literal("")),
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

export const shiftSchema = z.object({
  id: z.string(),
  name: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

export const shiftInputSchema = z.object({
  name: z.string().min(1),
  start_time: z.string(),
  end_time: z.string(),
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
  face_recognize_mode: z.string().optional(),
  webhook_token: z.string().optional(),
  webhook_host_id: z.string().optional(),
  webhook_url: z.string().optional(),
  webhook_status: z.enum(["unset", "configured", "testing", "active", "error"]).optional(),
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
    face_recognize_mode: z.string().optional(),
    webhook_token: z.string().optional(),
    webhook_host_id: z.string().optional(),
    webhook_url: z.string().optional(),
    webhook_status: z.enum(["unset", "configured", "testing", "active", "error"]).optional(),
  });

export const webhookConfigureSchema = z.object({
  security: z.string().optional(),
  iv: z.string().optional(),
  protocolType: z.string().optional(),
  parameterFormatType: z.string().optional(),
  addressingFormatType: z.string().optional(),
  httpAuthenticationMethod: z.string().optional(),
  ipAddress: z.string().optional(),
  portNo: z.union([z.number(), z.string()]).optional(),
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

export const terminalWebhookDeliverySchema = z.object({
  id: z.string(),
  terminal_id: z.string(),
  source: z.enum(["device_push", "device_test"]),
  success: z.boolean(),
  event_type: z.string().optional(),
  employee_no: z.string().optional(),
  clocking_event_id: z.string().optional(),
  error: z.string().optional(),
  payload_preview: z.string().optional(),
  created_at: z.string(),
});

export const clockingEventSchema = z.object({
  id: z.string(),
  guard_id: z.string().optional(),
  employee_no: z.string().optional(),
  terminal_id: z.string(),
  site_id: z.string(),
  event_type: z.enum(["clock_in", "clock_out", "unknown", "stranger"]),
  event_time: z.string(),
  created_at: z.string(),
});
