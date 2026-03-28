import { networkInterfaces } from "os";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalHostname(hostname: string) {
  return LOCAL_HOSTNAMES.has(hostname.trim().toLowerCase());
}

function isPrivateIpv4(address: string) {
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;

  const match = address.match(/^172\.(\d+)\./);
  if (!match) return false;

  const secondOctet = Number(match[1]);
  return secondOctet >= 16 && secondOctet <= 31;
}

function getLanIpv4Address() {
  const interfaces = networkInterfaces();
  const addresses = Object.values(interfaces)
    .flat()
    .filter((entry): entry is NonNullable<(typeof interfaces)[string]>[number] => Boolean(entry))
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter(isPrivateIpv4);

  return addresses[0] || null;
}

export function resolvePublicAppBaseUrl(requestUrl: string, headers?: Headers) {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    const configuredUrl = new URL(configured);
    if (isLocalHostname(configuredUrl.hostname)) {
      throw new Error(
        "APP_BASE_URL is pointing at localhost. Set APP_BASE_URL to a LAN-reachable URL so Hikvision terminals can reach the app."
      );
    }
    return configuredUrl.origin;
  }

  const requestOrigin = new URL(requestUrl);
  const forwardedHost = headers?.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = headers?.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || requestOrigin.protocol.replace(":", "");
  const host = forwardedHost || requestOrigin.host;
  const url = new URL(`${protocol}://${host}`);

  if (!isLocalHostname(url.hostname)) {
    return url.origin;
  }

  const lanAddress = getLanIpv4Address();
  if (!lanAddress) {
    throw new Error(
      "APP_BASE_URL is not configured and the current request is using localhost. Set APP_BASE_URL to a LAN-reachable URL so Hikvision terminals can download guard photos."
    );
  }

  url.hostname = lanAddress;
  return url.origin;
}
