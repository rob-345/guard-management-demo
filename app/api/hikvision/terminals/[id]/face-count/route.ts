import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

const faceCountQuerySchema = z.object({
  fdid: z.string().min(1),
  faceLibType: z.string().min(1),
  terminalNo: z.string().min(1).optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const parsed = faceCountQuerySchema.safeParse({
    fdid: request.nextUrl.searchParams.get("fdid") || undefined,
    faceLibType: request.nextUrl.searchParams.get("faceLibType") || undefined,
    terminalNo: request.nextUrl.searchParams.get("terminalNo") || undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid face count query" }, { status: 400 });
  }

  const result = await authorized.client.countFaces(
    parsed.data.fdid,
    parsed.data.faceLibType,
    parsed.data.terminalNo
  );

  return NextResponse.json(result);
}
