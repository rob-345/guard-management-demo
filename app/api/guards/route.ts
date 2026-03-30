import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { getSessionFromRequest } from "@/lib/auth";
import { hydrateGuardWithTerminalValidation, listGuardsWithTerminalValidation } from "@/lib/guard-directory";
import { GuardPhotoValidationError, parseGuardSubmission, storeGuardPhoto } from "@/lib/guard-media";
import {
  DEFAULT_GUARD_GENDER,
  DEFAULT_GUARD_PERSON_ROLE,
  DEFAULT_GUARD_PERSON_TYPE,
} from "@/lib/guard-terminal-state";
import { getCollection } from "@/lib/mongodb";
import type { Guard } from "@/lib/types";

const guardCreateSchema = z
  .object({
    employee_number: z.string().min(1),
    full_name: z.string().min(2),
    phone_number: z.string().min(9),
    email: z.string().email().optional().or(z.literal("")),
    person_type: z.enum(["normal", "visitor", "blackList"]).optional(),
    person_role: z.enum(["Guard", "Supervisor", "Manager"]).optional(),
    gender: z.enum(["male", "female", "unknown"]).optional(),
    status: z.enum(["active", "suspended", "on_leave"]).optional(),
    photo_url: z.string().optional().or(z.literal(""))
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const data = await listGuardsWithTerminalValidation({ persistCache: true });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch guards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const submission = await parseGuardSubmission(request);
    const parsed = guardCreateSchema.safeParse({
      employee_number: submission.employee_number,
      full_name: submission.full_name,
      phone_number: submission.phone_number,
      email: submission.email,
      person_type: submission.person_type,
      person_role: submission.person_role,
      gender: submission.gender,
      status: submission.status,
      photo_url: submission.photo_url
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid guard payload" }, { status: 400 });
    }

    const {
      employee_number,
      full_name,
      phone_number,
      email,
      person_type,
      person_role,
      gender,
      status,
      photo_url
    } = parsed.data;
    const guards = await getCollection<Guard>("guards");

    const existing = await guards.findOne({ employee_number });
    if (existing) {
      return NextResponse.json({ error: "Employee number already exists" }, { status: 400 });
    }

    const photoFile = submission.photo_file instanceof File ? submission.photo_file : undefined;
    if (!photoFile && !photo_url) {
      return NextResponse.json({ error: "A guard photo upload is required" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const guardId = uuidv4();
    let photoMetadata = {};
    if (photoFile) {
      try {
        photoMetadata = await storeGuardPhoto(photoFile);
      } catch (error) {
        if (error instanceof GuardPhotoValidationError) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        throw error;
      }
    }

    const guard: Guard = {
      id: guardId,
      employee_number,
      full_name,
      phone_number,
      email: email || "",
      person_type: person_type || DEFAULT_GUARD_PERSON_TYPE,
      person_role: person_role || DEFAULT_GUARD_PERSON_ROLE,
      gender: gender || DEFAULT_GUARD_GENDER,
      photo_url: photo_url || undefined,
      ...photoMetadata,
      facial_imprint_synced: false,
      status: status || "active",
      created_at: now,
      updated_at: now
    };

    await guards.insertOne({ ...guard, _id: guard.id } as any);

    const hydrated = await hydrateGuardWithTerminalValidation({
      guard,
      terminals: [],
      enrollments: [],
      persistCache: false
    });

    return NextResponse.json(hydrated, { status: 201 });
  } catch (error) {
    console.error("Failed to register guard:", error);
    return NextResponse.json({ error: "Failed to register guard" }, { status: 500 });
  }
}
