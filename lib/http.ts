export async function getApiErrorMessage(
  response: Response,
  fallback: string
) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      const data = await response.json();
      if (typeof data?.error === "string" && data.error.trim()) {
        return data.error;
      }
      if (typeof data?.message === "string" && data.message.trim()) {
        return data.message;
      }
    } catch {
      // Fall through to the text fallback below.
    }
  }

  try {
    const text = await response.text();
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}
