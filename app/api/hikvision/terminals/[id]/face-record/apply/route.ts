import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

const faceRecordApplySchema = z
  .object({
    fdid: z.string().min(1),
    faceLibType: z.string().min(1),
    faceUrl: z.string().url().optional(),
    modelData: z.string().optional(),
    fpid: z.string().optional(),
    name: z.string().optional(),
    employeeNo: z.string().optional(),
    extraFields: z.record(z.any()).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.faceUrl || value.modelData), {
    message: "faceUrl or modelData is required",
    path: ["faceUrl"],
  });

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const body = await request.json().catch(() => ({}));
  const parsed = faceRecordApplySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid face apply payload" }, { status: 400 });
  }

  const result = await authorized.client.applyFaceRecord(parsed.data);
  return NextResponse.json(result);
}
