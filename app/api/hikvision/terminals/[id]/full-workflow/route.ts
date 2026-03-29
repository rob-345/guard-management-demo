import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthorizedTerminal } from "@/lib/hikvision-admin";

const fullWorkflowSchema = z
  .object({
    fdid: z.string().min(1),
    faceLibType: z.string().min(1),
    terminalNo: z.string().optional(),
    fpid: z.string().optional(),
    name: z.string().optional(),
    employeeNo: z.string().optional(),
    faceUrl: z.string().url().optional(),
    modelData: z.string().optional(),
    extraFields: z.record(z.any()).optional(),
  })
  .strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authorized = await requireAuthorizedTerminal(request, id);
  if ("response" in authorized) {
    return authorized.response;
  }

  const body = await request.json().catch(() => ({}));
  const parsed = fullWorkflowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid full workflow payload" }, { status: 400 });
  }

  const result = await authorized.client.fullCaptureAndSyncWorkflow(parsed.data);
  return NextResponse.json(result);
}
