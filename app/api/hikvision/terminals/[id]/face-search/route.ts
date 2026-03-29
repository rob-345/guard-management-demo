import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

const faceSearchSchema = z
  .object({
    fdid: z.string().min(1),
    faceLibType: z.string().min(1),
    fpid: z.string().optional(),
    name: z.string().optional(),
    certificateNumber: z.string().optional(),
    isInLibrary: z.string().optional(),
    maxResults: z.number().int().positive().max(1000).optional(),
    searchResultPosition: z.number().int().min(0).optional(),
  })
  .strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const body = await request.json().catch(() => ({}));
  const parsed = faceSearchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid face search payload" }, { status: 400 });
  }

  const result = await authorized.client.searchFaceRecords(parsed.data.fdid, parsed.data.faceLibType, {
    fpid: parsed.data.fpid,
    name: parsed.data.name,
    certificateNumber: parsed.data.certificateNumber,
    isInLibrary: parsed.data.isInLibrary,
    maxResults: parsed.data.maxResults,
    searchResultPosition: parsed.data.searchResultPosition,
  });

  return NextResponse.json(result);
}
