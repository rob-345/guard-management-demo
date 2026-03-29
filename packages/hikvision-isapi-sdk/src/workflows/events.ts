import type { HikvisionHttpHostNotification } from "../models";
import type { HikvisionIsapiClient } from "../client";
import type { HikvisionSubscribeEventInput } from "../models";

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

export async function getHttpHosts(client: HikvisionIsapiClient) {
  return client.getHttpHosts();
}

export async function getHttpHost(client: HikvisionIsapiClient, hostId: string) {
  return client.getHttpHost(hostId);
}

export async function deleteHttpHost(client: HikvisionIsapiClient, hostId: string) {
  return client.deleteHttpHost(hostId);
}

export async function getHttpHostUploadCtrl(client: HikvisionIsapiClient, hostId: string) {
  return client.getHttpHostUploadCtrl(hostId);
}

export async function subscribeEvent(
  client: HikvisionIsapiClient,
  payload?: HikvisionSubscribeEventInput
) {
  return client.subscribeEvent(payload);
}

export async function unsubscribeEvent(client: HikvisionIsapiClient, id: string) {
  return client.unsubscribeEvent(id);
}
