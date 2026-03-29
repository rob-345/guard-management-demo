import type { HikvisionHttpHostNotification } from "../models";
import type { HikvisionIsapiClient } from "../client";

export async function configureHttpHost(
  client: HikvisionIsapiClient,
  hostId: string,
  notification: HikvisionHttpHostNotification,
  security?: string,
  iv?: string
) {
  return client.configureHttpHost(hostId, notification, security, iv);
}

export async function testHttpHost(client: HikvisionIsapiClient, hostId: string) {
  return client.testHttpHost(hostId);
}
