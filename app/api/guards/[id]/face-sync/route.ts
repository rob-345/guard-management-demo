import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-route";
import { getActiveGuardAssignment } from "@/lib/guard-assignments";
import { syncGuardToTerminals } from "@/lib/guard-terminal-sync";
import { getCollection } from "@/lib/mongodb";
import { resolvePublicAppBaseUrl } from "@/lib/public-origin";
import type { Guard, Terminal } from "@/lib/types";

const syncSchema = z
  .object({
    terminal_ids: z.array(z.string().min(1)).min(1),
    force: z.boolean().optional(),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = syncSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid face sync payload" }, { status: 400 });
  }

  const [guards, terminals, assignment] = await Promise.all([
    getCollection<Guard>("guards"),
    getCollection<Terminal>("terminals"),
    getActiveGuardAssignment(id, { hydrate: false }),
  ]);

  const [guardDoc, allTerminalDocs] = await Promise.all([
    guards.findOne({ id }),
    terminals.find({}).toArray(),
  ]);

  if (!guardDoc) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  if (!assignment) {
    return NextResponse.json(
      { error: "Assign the guard to a site before syncing terminals." },
      { status: 400 }
    );
  }

  const allowedTerminals = allTerminalDocs.filter(
    (terminal) => terminal.site_id === assignment.site_id
  );
  const allowedIds = new Set(allowedTerminals.map((terminal) => terminal.id));
  const invalidIds = parsed.data.terminal_ids.filter((terminalId) => !allowedIds.has(terminalId));
  if (invalidIds.length > 0) {
    return NextResponse.json(
      { error: "Selected terminals must belong to the guard's assigned site." },
      { status: 400 }
    );
  }

  const selectedTerminals = allowedTerminals.filter((terminal) =>
    parsed.data.terminal_ids.includes(terminal.id)
  );

  if (selectedTerminals.length === 0) {
    return NextResponse.json({ error: "No matching terminals found" }, { status: 404 });
  }

  const publicBaseUrl = resolvePublicAppBaseUrl(request.url, request.headers);
  const result = await syncGuardToTerminals({
    guard: guardDoc,
    terminals: selectedTerminals,
    validationTerminals: allowedTerminals,
    publicBaseUrl,
  });

  return NextResponse.json(result);
}
