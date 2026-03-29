import { NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/api-route";
import { generateOpenApiDocument } from "@/lib/openapi/spec";

export async function GET(request: NextRequest) {
  const unauthorized = await requireSession(request);
  if (unauthorized) {
    return unauthorized;
  }

  return NextResponse.json(generateOpenApiDocument(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
