import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "./api-route";
import { HikvisionClient } from "./hikvision";
import { getCollection } from "./mongodb";
import type { Terminal } from "./types";

export async function requireAuthorizedTerminal(
  request: NextRequest,
  id: string
): Promise<
  | { terminal: Terminal; client: HikvisionClient }
  | { response: NextResponse }
> {
  const unauthorized = await requireSession(request);
  if (unauthorized) {
    return { response: unauthorized };
  }

  const terminals = await getCollection<Terminal>("terminals");
  const terminal = await terminals.findOne({ id });
  if (!terminal) {
    return {
      response: NextResponse.json({ error: "Terminal not found" }, { status: 404 }),
    };
  }

  return {
    terminal,
    client: new HikvisionClient(terminal),
  };
}
