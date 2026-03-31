import type {
  HikvisionDebugExchange,
  HikvisionDebugRequest,
  HikvisionDebugResponse,
} from "./models";

function isTextLikeContentType(contentType?: string | null) {
  const normalized = (contentType || "").toLowerCase();
  return (
    normalized.includes("json") ||
    normalized.includes("xml") ||
    normalized.includes("text/") ||
    normalized.includes("multipart/")
  );
}

function bodyToDebugParts(body: BodyInit | null | undefined, contentType?: string) {
  if (body === undefined || body === null) {
    return {};
  }

  if (typeof body === "string") {
    return {
      bodyText: body,
      bodyBytes: Buffer.byteLength(body),
    };
  }

  if (body instanceof URLSearchParams) {
    const text = body.toString();
    return {
      bodyText: text,
      bodyBytes: Buffer.byteLength(text),
    };
  }

  if (body instanceof FormData) {
    return {
      bodyText: "[form-data omitted]",
    };
  }

  if (body instanceof Blob) {
    return {
      bodyBytes: body.size,
      bodyText: isTextLikeContentType(contentType) ? `[blob ${body.size} bytes]` : undefined,
    };
  }

  if (body instanceof ArrayBuffer) {
    return {
      bodyBytes: body.byteLength,
      bodyText: isTextLikeContentType(contentType) ? Buffer.from(body).toString("utf8") : undefined,
    };
  }

  if (ArrayBuffer.isView(body)) {
    const buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    return {
      bodyBytes: buffer.length,
      bodyText: isTextLikeContentType(contentType) ? buffer.toString("utf8") : undefined,
    };
  }

  return {
    bodyText: `[${Object.prototype.toString.call(body)}]`,
  };
}

function normalizeHeaders(headers: HeadersInit | undefined) {
  const normalized = new Headers(headers || {});
  return Object.fromEntries(normalized.entries());
}

function maskCallbackToken(text: string, showTokens = false) {
  if (showTokens) return text;
  return text.replace(
    /(\/api\/events\/hikvision\/)([A-Za-z0-9]+)/g,
    (_, prefix: string, token: string) => `${prefix}${token.slice(0, 6)}...${token.slice(-4)}`
  );
}

function redactValue(key: string, value: unknown, showTokens = false): unknown {
  if (typeof value === "string") {
    if (/(password|authorization|digest)/i.test(key)) {
      return "***redacted***";
    }
    return maskCallbackToken(value, showTokens);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(key, entry, showTokens));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryKey, entryValue, showTokens),
      ])
    );
  }

  return value;
}

function buildRequestSnapshot(input: RequestInfo | URL, init: RequestInit | undefined): HikvisionDebugRequest {
  const request = input instanceof Request ? input : null;
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : request?.url || "";
  const headers = normalizeHeaders(init?.headers ?? request?.headers);
  const contentType = headers["content-type"];
  const body = bodyToDebugParts((init?.body as BodyInit | null | undefined) ?? null, contentType);
  const pathname = (() => {
    try {
      return new URL(url).pathname + new URL(url).search;
    } catch {
      return url;
    }
  })();

  return {
    method: (init?.method || request?.method || "GET").toUpperCase(),
    path: pathname,
    url,
    headers,
    contentType,
    bodyText: body.bodyText,
    bodyBytes: body.bodyBytes,
  };
}

async function buildResponseSnapshot(
  response: Response,
  options?: {
    maxBodyBytes?: number;
  }
): Promise<HikvisionDebugResponse> {
  const headers = Object.fromEntries(response.headers.entries());
  const contentType = headers["content-type"];
  const pathname = (() => {
    try {
      return new URL(response.url).pathname;
    } catch {
      return response.url;
    }
  })();

  if (pathname.includes("/alertStream")) {
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      contentType,
    };
  }

  const cloned = response.clone();
  const buffer = Buffer.from(await cloned.arrayBuffer());
  const maxBodyBytes = options?.maxBodyBytes ?? 512 * 1024;
  const rawBuffer = buffer.length > maxBodyBytes ? buffer.subarray(0, maxBodyBytes) : buffer;

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    contentType,
    bodyBytes: buffer.length,
    bodyText: isTextLikeContentType(contentType) ? rawBuffer.toString("utf8") : undefined,
  };
}

export function redactDebugExchange(exchange: HikvisionDebugExchange, showTokens = false): HikvisionDebugExchange {
  return redactValue("exchange", exchange, showTokens) as HikvisionDebugExchange;
}

export function createTracingFetch(
  baseFetch: typeof fetch = fetch,
  options?: {
    maxBodyBytes?: number;
    showTokens?: boolean;
  }
) {
  const exchanges: HikvisionDebugExchange[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const request = buildRequestSnapshot(input, init);
    const startedAt = new Date().toISOString();

    try {
      const response = await baseFetch(input, init);
      const responseSnapshot = await buildResponseSnapshot(response, {
        maxBodyBytes: options?.maxBodyBytes,
      });

      exchanges.push({
        timestamp: startedAt,
        request,
        response: responseSnapshot,
      });

      return response;
    } catch (error) {
      exchanges.push({
        timestamp: startedAt,
        request,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  };

  return {
    fetchImpl,
    getExchanges() {
      return exchanges.map((exchange) => redactDebugExchange(exchange, options?.showTokens));
    },
    clearExchanges() {
      exchanges.splice(0, exchanges.length);
    },
    consumeExchanges() {
      const snapshot = exchanges.map((exchange) => redactDebugExchange(exchange, options?.showTokens));
      exchanges.splice(0, exchanges.length);
      return snapshot;
    },
  };
}

export function redactJsonLike<T>(value: T, showTokens = false): T {
  return redactValue("root", value, showTokens) as T;
}
