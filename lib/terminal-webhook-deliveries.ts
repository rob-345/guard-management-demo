import { v4 as uuidv4 } from "uuid";

import { getCollection } from "./mongodb";
import type { TerminalWebhookDelivery } from "./types";

const MAX_PREVIEW_LENGTH = 800;

export function buildWebhookPayloadPreview(payload: unknown) {
  const raw =
    typeof payload === "string"
      ? payload
      : (() => {
          try {
            return JSON.stringify(payload);
          } catch {
            return String(payload);
          }
        })();

  return raw.length > MAX_PREVIEW_LENGTH ? `${raw.slice(0, MAX_PREVIEW_LENGTH)}...` : raw;
}

export async function recordTerminalWebhookDelivery(
  input: Omit<TerminalWebhookDelivery, "id" | "created_at">
) {
  const collection = await getCollection<TerminalWebhookDelivery>("terminal_webhook_deliveries");
  const delivery: TerminalWebhookDelivery = {
    id: uuidv4(),
    created_at: new Date().toISOString(),
    ...input
  };

  await collection.insertOne({ ...delivery, _id: delivery.id } as never);
  return delivery;
}

