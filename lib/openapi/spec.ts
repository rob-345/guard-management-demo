import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
  authLoginSchema,
  clockingEventSchema,
  errorResponseSchema,
  faceRemoveSchema,
  faceSyncSchema,
  guardMultipartSchema,
  guardSchema,
  guardUpdateMultipartSchema,
  hikvisionFaceRecordSchema,
  hikvisionFaceSearchSchema,
  hikvisionFullWorkflowSchema,
  shiftInputSchema,
  shiftSchema,
  siteInputSchema,
  siteSchema,
  successResponseSchema,
  terminalCreateSchema,
  terminalSchema,
  terminalUpdateSchema,
  terminalWebhookDeliverySchema,
  webhookConfigureSchema,
  webhookSubscribeSchema,
  webhookUnsubscribeSchema,
} from "./schemas";

const registry = new OpenAPIRegistry();

const Guard = registry.register("Guard", guardSchema);
const Site = registry.register("Site", siteSchema);
const Shift = registry.register("Shift", shiftSchema);
const Terminal = registry.register("Terminal", terminalSchema);
const ClockingEvent = registry.register("ClockingEvent", clockingEventSchema);
const WebhookDelivery = registry.register("TerminalWebhookDelivery", terminalWebhookDeliverySchema);
const ErrorResponse = registry.register("ErrorResponse", errorResponseSchema);
const SuccessResponse = registry.register("SuccessResponse", successResponseSchema);

const IdParam = z.object({
  id: z.string().openapi({
    param: {
      name: "id",
      in: "path",
      required: true,
    },
  }),
});

const TokenParam = z.object({
  token: z.string().openapi({
    param: {
      name: "token",
      in: "path",
      required: true,
    },
  }),
});

const jsonContent = (schema: z.ZodTypeAny) => ({
  "application/json": {
    schema,
  },
});

const multipartContent = (schema: z.ZodTypeAny) => ({
  "multipart/form-data": {
    schema,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/login",
  tags: ["Auth"],
  summary: "Log in with email and password",
  request: {
    body: {
      content: jsonContent(authLoginSchema),
    },
  },
  responses: {
    200: {
      description: "Login succeeded",
      content: jsonContent(successResponseSchema),
    },
    400: { description: "Invalid payload", content: jsonContent(ErrorResponse) },
    401: { description: "Invalid credentials", content: jsonContent(ErrorResponse) },
    403: { description: "Account inactive", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/auth/logout",
  tags: ["Auth"],
  summary: "Clear the current session",
  responses: {
    200: {
      description: "Logout succeeded",
      content: jsonContent(successResponseSchema),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/guards",
  tags: ["Guards"],
  summary: "List guards",
  security: [{ sessionCookie: [] }],
  responses: {
    200: { description: "Guard list", content: jsonContent(z.array(Guard)) },
    401: { description: "Unauthorized", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/guards",
  tags: ["Guards"],
  summary: "Create a guard",
  security: [{ sessionCookie: [] }],
  request: {
    body: {
      content: multipartContent(guardMultipartSchema),
    },
  },
  responses: {
    201: { description: "Guard created", content: jsonContent(Guard) },
    400: { description: "Invalid payload", content: jsonContent(ErrorResponse) },
    401: { description: "Unauthorized", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/guards/{id}",
  tags: ["Guards"],
  summary: "Get a guard",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Guard", content: jsonContent(Guard) },
    404: { description: "Guard not found", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/guards/{id}",
  tags: ["Guards"],
  summary: "Update a guard",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: {
      content: multipartContent(guardUpdateMultipartSchema),
    },
  },
  responses: {
    200: { description: "Updated guard", content: jsonContent(Guard) },
    400: { description: "Invalid payload", content: jsonContent(ErrorResponse) },
    404: { description: "Guard not found", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/guards/{id}",
  tags: ["Guards"],
  summary: "Delete a guard and clean up terminal enrollments",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Guard deleted", content: jsonContent(z.object({ success: z.boolean(), id: z.string() }).passthrough()) },
    404: { description: "Guard not found", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/guards/{id}/face-sync",
  tags: ["Guards"],
  summary: "Sync a guard face to selected terminals",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: { content: jsonContent(faceSyncSchema) },
  },
  responses: {
    200: {
      description: "Face sync result",
      content: jsonContent(
        z.object({
          guard_id: z.string(),
          facial_imprint_synced: z.boolean(),
          summary: z.object({
            facial_imprint_synced: z.boolean(),
            synced_count: z.number(),
            failed_count: z.number(),
            pending_count: z.number(),
          }).passthrough(),
          results: z.array(
            z.object({
              terminal_id: z.string(),
              status: z.string(),
              already_present: z.boolean().optional(),
              error: z.string().optional(),
            })
          ),
        })
      ),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/guards/{id}/face-remove",
  tags: ["Guards"],
  summary: "Remove a guard face from selected terminals",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: { content: jsonContent(faceRemoveSchema) },
  },
  responses: {
    200: { description: "Face removal result", content: jsonContent(z.object({ guard_id: z.string() }).passthrough()) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/guards/{id}/photo",
  tags: ["Guards"],
  summary: "Stream the stored guard photo",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Guard photo binary" },
    404: { description: "Photo not found", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/sites",
  tags: ["Sites"],
  summary: "List sites",
  security: [{ sessionCookie: [] }],
  responses: {
    200: { description: "Site list", content: jsonContent(z.array(Site)) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/sites",
  tags: ["Sites"],
  summary: "Create a site",
  security: [{ sessionCookie: [] }],
  request: { body: { content: jsonContent(siteInputSchema) } },
  responses: {
    201: { description: "Site created", content: jsonContent(Site) },
    400: { description: "Invalid payload", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/sites/{id}",
  tags: ["Sites"],
  summary: "Get a site",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Site", content: jsonContent(Site) },
    404: { description: "Site not found", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/sites/{id}",
  tags: ["Sites"],
  summary: "Update a site",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam, body: { content: jsonContent(siteInputSchema.partial()) } },
  responses: {
    200: { description: "Updated site", content: jsonContent(Site) },
    400: { description: "Invalid payload", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/sites/{id}",
  tags: ["Sites"],
  summary: "Delete a site",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Site deleted", content: jsonContent(z.object({ success: z.boolean(), id: z.string() })) },
    409: { description: "Site still has terminals", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/shifts",
  tags: ["Shifts"],
  summary: "List shifts",
  security: [{ sessionCookie: [] }],
  responses: {
    200: { description: "Shift list", content: jsonContent(z.array(Shift)) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/shifts",
  tags: ["Shifts"],
  summary: "Create a shift",
  security: [{ sessionCookie: [] }],
  request: { body: { content: jsonContent(shiftInputSchema) } },
  responses: {
    201: { description: "Shift created", content: jsonContent(Shift) },
    400: { description: "Invalid payload", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/shifts/{id}",
  tags: ["Shifts"],
  summary: "Get a shift",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Shift", content: jsonContent(Shift) },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/shifts/{id}",
  tags: ["Shifts"],
  summary: "Update a shift",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam, body: { content: jsonContent(shiftInputSchema.partial()) } },
  responses: {
    200: { description: "Updated shift", content: jsonContent(Shift) },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/shifts/{id}",
  tags: ["Shifts"],
  summary: "Delete a shift",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Shift deleted", content: jsonContent(z.object({ success: z.boolean(), id: z.string() })) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/terminals",
  tags: ["Terminals"],
  summary: "List registered terminals",
  security: [{ sessionCookie: [] }],
  responses: {
    200: { description: "Terminal list", content: jsonContent(z.array(Terminal)) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals",
  tags: ["Terminals"],
  summary: "Register a terminal",
  security: [{ sessionCookie: [] }],
  request: { body: { content: jsonContent(terminalCreateSchema) } },
  responses: {
    201: { description: "Terminal created", content: jsonContent(Terminal) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/terminals/{id}",
  tags: ["Terminals"],
  summary: "Get a terminal",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Terminal", content: jsonContent(Terminal) },
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/terminals/{id}",
  tags: ["Terminals"],
  summary: "Update a terminal",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam, body: { content: jsonContent(terminalUpdateSchema) } },
  responses: {
    200: { description: "Updated terminal", content: jsonContent(Terminal) },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/terminals/{id}",
  tags: ["Terminals"],
  summary: "Delete a terminal and clean up enrollments",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Terminal deleted", content: jsonContent(z.object({ success: z.boolean(), id: z.string() }).passthrough()) },
    500: { description: "Cleanup failed", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals/{id}/probe",
  tags: ["Terminals"],
  summary: "Probe a terminal and refresh its stored status",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Probed terminal", content: jsonContent(z.object({ terminal: Terminal })) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals/{id}/activate",
  tags: ["Terminals"],
  summary: "Check terminal activation state",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Activation status", content: jsonContent(z.object({ activation_status: z.string() }).passthrough()) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/terminals/{id}/snapshot",
  tags: ["Terminals"],
  summary: "Fetch a terminal snapshot image",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Snapshot image" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/terminals/{id}/snapshot/capabilities",
  tags: ["Terminals"],
  summary: "Fetch terminal snapshot capabilities",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Snapshot capabilities", content: jsonContent(z.record(z.any())) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals/{id}/capture-face",
  tags: ["Terminals"],
  summary: "Trigger device-side face capture",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Captured image" },
    408: { description: "Capture timed out", content: jsonContent(ErrorResponse.extend({ status: z.string().optional() })) },
    409: { description: "Terminal busy or unavailable", content: jsonContent(ErrorResponse.extend({ status: z.string().optional() })) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals/{id}/capture-face/cancel",
  tags: ["Terminals"],
  summary: "Cancel terminal face capture",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Capture cancelled", content: jsonContent(z.object({ success: z.boolean() }).passthrough()) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals/{id}/webhook-configure",
  tags: ["Terminals"],
  summary: "Configure Hikvision webhook push for a terminal",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam, body: { content: jsonContent(webhookConfigureSchema) } },
  responses: {
    200: { description: "Webhook configured", content: jsonContent(z.object({ terminal: Terminal, callback_url: z.string() }).passthrough()) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals/{id}/webhook-test",
  tags: ["Terminals"],
  summary: "Ask the terminal to test its webhook callback URL",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Webhook test result", content: jsonContent(z.object({ success: z.boolean(), result: z.any() })) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals/{id}/webhook-subscribe",
  tags: ["Terminals"],
  summary: "Subscribe a terminal to Hikvision event notifications",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: { content: jsonContent(webhookSubscribeSchema) },
  },
  responses: {
    200: {
      description: "Webhook subscription enabled",
      content: jsonContent(z.object({
        success: z.boolean(),
        subscription_id: z.string().optional(),
        result: z.any(),
        terminal: Terminal.optional(),
      }).passthrough()),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/terminals/{id}/webhook-unsubscribe",
  tags: ["Terminals"],
  summary: "Unsubscribe a terminal from Hikvision event notifications",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: { content: jsonContent(webhookUnsubscribeSchema) },
  },
  responses: {
    200: {
      description: "Webhook subscription disabled",
      content: jsonContent(z.object({
        success: z.boolean(),
        subscription_id: z.string().optional(),
        result: z.any(),
        terminal: Terminal.optional(),
      }).passthrough()),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/terminals/{id}/webhook-upload-control",
  tags: ["Terminals"],
  summary: "Inspect Hikvision webhook upload control for a terminal",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: "Webhook upload control state",
      content: jsonContent(z.object({
        success: z.boolean(),
        upload_ctrl: z.record(z.any()),
        terminal: Terminal.optional(),
      }).passthrough()),
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/terminals/{id}/webhook-hosts",
  tags: ["Terminals"],
  summary: "Inspect live Hikvision HTTP webhook hosts for a terminal",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: {
      description: "Configured webhook hosts on the device",
      content: jsonContent(z.object({
        success: z.boolean(),
        webhook_hosts: z.array(z.any()),
        terminal: Terminal.optional(),
      }).passthrough()),
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/terminals/{id}/webhook-hosts/{hostId}",
  tags: ["Terminals"],
  summary: "Delete a Hikvision HTTP webhook host from the device",
  security: [{ sessionCookie: [] }],
  request: {
    params: z.object({
      id: z.string(),
      hostId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Webhook host deleted",
      content: jsonContent(z.object({
        success: z.boolean(),
        webhook_hosts: z.array(z.any()).optional(),
        terminal: Terminal.optional(),
      }).passthrough()),
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/events/ingest",
  tags: ["Events"],
  summary: "Ingest raw event payloads with the shared ingest secret",
  responses: {
    200: { description: "Ingested event", content: jsonContent(z.object({ success: z.boolean() }).passthrough()) },
    401: { description: "Missing or invalid ingest secret", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/events/hikvision/{token}",
  tags: ["Events"],
  summary: "Receive Hikvision webhook event callbacks",
  request: { params: TokenParam },
  responses: {
    200: { description: "Webhook accepted", content: jsonContent(z.object({ success: z.boolean() }).passthrough()) },
    404: { description: "Terminal not found", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/public/guards/{id}/photo",
  tags: ["Guards"],
  summary: "Stream a signed public guard photo for terminal consumption",
  request: {
    params: IdParam,
    query: z.object({
      token: z.string(),
    }),
  },
  responses: {
    200: { description: "Guard photo binary" },
    401: { description: "Missing token", content: jsonContent(ErrorResponse) },
    403: { description: "Invalid token", content: jsonContent(ErrorResponse) },
    410: { description: "Stale token", content: jsonContent(ErrorResponse) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/hikvision/terminals/{id}/capabilities",
  tags: ["Hikvision SDK"],
  summary: "Inspect SDK-backed capability snapshots for a terminal",
  security: [{ sessionCookie: [] }],
  request: { params: IdParam },
  responses: {
    200: { description: "Capabilities", content: jsonContent(z.object({ terminal_id: z.string(), capabilities: z.record(z.any()) })) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/hikvision/terminals/{id}/face-count",
  tags: ["Hikvision SDK"],
  summary: "Count records in a Hikvision face library",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    query: z.object({
      fdid: z.string(),
      faceLibType: z.string(),
      terminalNo: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Face count", content: jsonContent(z.object({ recordDataNumber: z.number(), fdid: z.string(), faceLibType: z.string() }).passthrough()) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/hikvision/terminals/{id}/face-search",
  tags: ["Hikvision SDK"],
  summary: "Search Hikvision face records",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: { content: jsonContent(hikvisionFaceSearchSchema) },
  },
  responses: {
    200: { description: "Face search results", content: jsonContent(z.object({ totalMatches: z.number(), records: z.array(z.record(z.any())) }).passthrough()) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/hikvision/terminals/{id}/face-record",
  tags: ["Hikvision SDK"],
  summary: "Add a face record with FaceDataRecord",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: { content: jsonContent(hikvisionFaceRecordSchema) },
  },
  responses: {
    201: { description: "Face record added", content: jsonContent(z.object({ success: z.boolean(), fpid: z.string().optional() }).passthrough()) },
  },
});

registry.registerPath({
  method: "put",
  path: "/api/hikvision/terminals/{id}/face-record/apply",
  tags: ["Hikvision SDK"],
  summary: "Upsert a face record with FDSetUp",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: { content: jsonContent(hikvisionFaceRecordSchema) },
  },
  responses: {
    200: { description: "Face record applied", content: jsonContent(z.object({ success: z.boolean(), fpid: z.string().optional() }).passthrough()) },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/hikvision/terminals/{id}/full-workflow",
  tags: ["Hikvision SDK"],
  summary: "Run capture, add/apply, and verify in one SDK workflow",
  security: [{ sessionCookie: [] }],
  request: {
    params: IdParam,
    body: { content: jsonContent(hikvisionFullWorkflowSchema) },
  },
  responses: {
    200: { description: "Full workflow result", content: jsonContent(z.object({ verified: z.boolean(), captureSucceeded: z.boolean(), uploadSucceeded: z.boolean() }).passthrough()) },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/openapi.json",
  tags: ["Docs"],
  summary: "Fetch the generated OpenAPI document",
  security: [{ sessionCookie: [] }],
  responses: {
    200: { description: "OpenAPI document", content: jsonContent(z.record(z.any())) },
  },
});

export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Guard Management Demo API",
      version: "1.0.0",
      description:
        "REST API for the guard management demo, including Hikvision ISAPI-backed terminal operations.",
    },
    tags: [
      { name: "Auth" },
      { name: "Guards" },
      { name: "Sites" },
      { name: "Shifts" },
      { name: "Terminals" },
      { name: "Events" },
      { name: "Hikvision SDK" },
      { name: "Docs" },
    ],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "session",
          description: "Session cookie set by the login route.",
        },
      },
    },
    servers: [
      {
        url: "/",
        description: "Current app origin",
      },
    ],
  });
}
