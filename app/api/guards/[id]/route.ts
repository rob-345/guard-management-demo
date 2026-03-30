import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession, compactDefined } from "@/lib/api-route";
import { hydrateGuardWithTerminalValidation } from "@/lib/guard-directory";
import { resolveGuardFaceEnrollmentEmployeeNo } from "@/lib/guard-face";
import { buildGuardPhotoUrl } from "@/lib/guard-photo-access";
import {
  GuardPhotoValidationError,
  loadGuardPhoto,
  parseGuardSubmission,
  removeGuardPhoto,
  storeGuardPhoto
} from "@/lib/guard-media";
import {
  buildGuardTerminalUserInfo,
  DEFAULT_GUARD_GENDER,
  DEFAULT_GUARD_PERSON_ROLE,
  DEFAULT_GUARD_PERSON_TYPE,
  normalizeGuardRecord,
  validateGuardAcrossTerminals
} from "@/lib/guard-terminal-state";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import { resolvePublicAppBaseUrl } from "@/lib/public-origin";
import type { Alert, Guard, GuardAssignment, GuardFaceEnrollment, Terminal } from "@/lib/types";

const guardUpdateSchema = z
  .object({
    employee_number: z.string().min(1).optional(),
    full_name: z.string().min(2).optional(),
    phone_number: z.string().min(9).optional(),
    email: z.string().email().optional().or(z.literal("")),
    person_type: z.enum(["normal", "visitor", "blackList"]).optional(),
    person_role: z.enum(["Guard", "Supervisor", "Manager"]).optional(),
    gender: z.enum(["male", "female", "unknown"]).optional(),
    status: z.enum(["active", "suspended", "on_leave"]).optional(),
    photo_url: z.string().optional().or(z.literal("")),
    remove_photo: z.boolean().optional()
  })
  .strict();

async function getGuardCollection() {
  return getCollection<Guard>("guards");
}

function activeEnrollments(enrollments: GuardFaceEnrollment[]) {
  return enrollments.filter((enrollment) => enrollment.status !== "removed");
}

function hasTerminalProfileChanges(
  existing: Guard,
  next: Guard,
  photoChanged: boolean
) {
  return (
    photoChanged ||
    existing.full_name !== next.full_name ||
    existing.phone_number !== next.phone_number ||
    (existing.person_type || DEFAULT_GUARD_PERSON_TYPE) !== next.person_type ||
    (existing.person_role || DEFAULT_GUARD_PERSON_ROLE) !== next.person_role ||
    (existing.gender || DEFAULT_GUARD_GENDER) !== next.gender
  );
}

async function deleteGuardPhotoFields(guard: Guard) {
  if (guard.photo_file_id) {
    await removeGuardPhoto({
      photo_file_id: guard.photo_file_id,
      photo_filename: guard.photo_filename,
      photo_mime_type: guard.photo_mime_type,
      photo_size: guard.photo_size
    });
  }
}

async function syncGuardProfileToTerminals(options: {
  request: NextRequest;
  guard: Guard;
  terminals: Terminal[];
  enrollments: GuardFaceEnrollment[];
  rerunFaceEnrollment: boolean;
}) {
  const { request, guard, terminals, enrollments, rerunFaceEnrollment } = options;
  const active = activeEnrollments(enrollments);

  if (active.length === 0) {
    return {
      results: [],
      summary: guard.terminal_validation,
    };
  }

  const terminalIds = active.map((enrollment) => enrollment.terminal_id);
  const terminalDocs = terminals.filter((terminal) => terminalIds.includes(terminal.id));
  const normalizedGuard = normalizeGuardRecord(guard);
  const userInfo = buildGuardTerminalUserInfo(normalizedGuard);
  const enrollmentCollection = await getCollection<GuardFaceEnrollment>("guard_face_enrollments");
  const photo = rerunFaceEnrollment ? await loadGuardPhoto(normalizedGuard).catch(() => null) : null;
  let publicBaseUrl: string | null = null;

  if (rerunFaceEnrollment && !photo) {
    const error = "Updated guard photo could not be loaded for terminal re-enrollment";
    for (const enrollment of active) {
      await enrollmentCollection.updateOne(
        { guard_id: guard.id, terminal_id: enrollment.terminal_id },
        {
          $set: {
            status: "failed",
            error,
            updated_at: new Date().toISOString(),
          },
        }
      );
    }

    const summary = await validateGuardAcrossTerminals({
      guard: normalizedGuard,
      terminals,
      enrollments: await enrollmentCollection.find({ guard_id: guard.id }).toArray(),
      enrollmentCollection,
      guardCollection: await getGuardCollection(),
      persistCache: true,
    });

    return {
      results: active.map((enrollment) => ({
        terminal_id: enrollment.terminal_id,
        status: "failed",
        error,
      })),
      summary,
    };
  }

  if (rerunFaceEnrollment && photo) {
    publicBaseUrl = resolvePublicAppBaseUrl(request.url, request.headers);
  }

  const optimisticResults: Array<{
    terminal_id: string;
    status: string;
    already_present?: boolean;
    error?: string;
  }> = [];

  for (const enrollment of active) {
    const terminal = terminalDocs.find((entry) => entry.id === enrollment.terminal_id);
    if (!terminal) {
      const error = "Terminal not found";
      optimisticResults.push({
        terminal_id: enrollment.terminal_id,
        status: "validation_error",
        error,
      });
      await enrollmentCollection.updateOne(
        { guard_id: guard.id, terminal_id: enrollment.terminal_id },
        {
          $set: {
            status: "failed",
            error,
            updated_at: new Date().toISOString(),
          },
        }
      );
      continue;
    }

    const employeeNo = resolveGuardFaceEnrollmentEmployeeNo(normalizedGuard, enrollment);

    try {
      const client = new HikvisionClient(terminal);
      if (rerunFaceEnrollment && photo && publicBaseUrl) {
        const registration = await client.registerFace({
          employeeNo,
          name: normalizedGuard.full_name,
          faceUrl: buildGuardPhotoUrl(publicBaseUrl, normalizedGuard, terminal),
          image: photo.buffer,
          filename: photo.filename,
          mimeType: photo.mimeType,
          userInfo,
        });

        optimisticResults.push({
          terminal_id: terminal.id,
          status: "syncing",
          already_present: Boolean(registration.alreadyPresent),
        });
      } else {
        await client.upsertUserInfo({
          employeeNo,
          name: normalizedGuard.full_name,
          userInfo,
        });

        optimisticResults.push({
          terminal_id: terminal.id,
          status: "syncing",
        });
      }

      await enrollmentCollection.updateOne(
        { guard_id: guard.id, terminal_id: terminal.id },
        {
          $set: {
            device_employee_no: employeeNo,
            status: "syncing",
            updated_at: new Date().toISOString(),
          },
          $unset: {
            error: "",
            last_validation_error: "",
          },
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Terminal sync failed";
      optimisticResults.push({
        terminal_id: terminal.id,
        status: "failed",
        error: message,
      });

      await enrollmentCollection.updateOne(
        { guard_id: guard.id, terminal_id: terminal.id },
        {
          $set: {
            status: "failed",
            error: message,
            updated_at: new Date().toISOString(),
          },
        }
      );
    }
  }

  const refreshedEnrollments = await enrollmentCollection.find({ guard_id: guard.id }).toArray();
  const summary = await validateGuardAcrossTerminals({
    guard: normalizedGuard,
    terminals,
    enrollments: refreshedEnrollments,
    enrollmentCollection,
    guardCollection: await getGuardCollection(),
    persistCache: true,
  });

  const validationByTerminalId = new Map(
    summary.validations.map((validation) => [validation.terminal_id, validation])
  );

  const results = optimisticResults.map((result) => {
    const validation = validationByTerminalId.get(result.terminal_id);
    if (!validation) {
      return result;
    }

    return {
      ...result,
      status: validation.status === "verified" ? "verified" : validation.status,
      error: result.error || validation.error,
      face_present: validation.face_present,
      user_present: validation.user_present,
      details_match: validation.details_match,
      access_ready: validation.access_ready,
      validated_at: validation.validated_at,
      mismatches: validation.mismatches,
    };
  });

  return { results, summary };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const guards = await getGuardCollection();
  const guard = await guards.findOne({ id });

  if (!guard) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  const hydrated = await hydrateGuardWithTerminalValidation({
    guard,
    persistCache: true,
  });

  return NextResponse.json(hydrated);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const submission = await parseGuardSubmission(request);
  const parsed = guardUpdateSchema.safeParse({
    employee_number: submission.employee_number,
    full_name: submission.full_name,
    phone_number: submission.phone_number,
    email: submission.email,
    person_type: submission.person_type,
    person_role: submission.person_role,
    gender: submission.gender,
    status: submission.status,
    photo_url: submission.photo_url,
    remove_photo: submission.remove_photo
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid guard payload" }, { status: 400 });
  }

  const { remove_photo: _removePhoto, ...guardPayload } = parsed.data;
  const updates = compactDefined(guardPayload);
  const photoFile = submission.photo_file instanceof File ? submission.photo_file : undefined;
  const wantsPhotoRemoval = parsed.data.remove_photo === true;

  if (Object.keys(updates).length === 0 && !photoFile && !wantsPhotoRemoval) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const guards = await getGuardCollection();
  const terminals = await getCollection<Terminal>("terminals");
  const enrollments = await getCollection<GuardFaceEnrollment>("guard_face_enrollments");

  const [existing, guardEnrollments, terminalDocs] = await Promise.all([
    guards.findOne({ id }),
    enrollments.find({ guard_id: id }).toArray(),
    terminals.find({}).toArray(),
  ]);

  if (!existing) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  const activeGuardEnrollments = activeEnrollments(guardEnrollments);
  const hasActiveEnrollment = activeGuardEnrollments.length > 0;

  if (
    typeof updates.employee_number === "string" &&
    updates.employee_number !== existing.employee_number
  ) {
    if (hasActiveEnrollment) {
      return NextResponse.json(
        {
          error:
            "Employee number cannot be changed after the guard has been enrolled on a terminal. Remove the guard from all terminals first."
        },
        { status: 409 }
      );
    }

    const duplicate = await guards.findOne({
      employee_number: updates.employee_number,
      id: { $ne: id }
    });

    if (duplicate) {
      return NextResponse.json({ error: "Employee number already exists" }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const nextGuard: Partial<Guard> & Record<string, unknown> = {
    ...updates,
    updated_at: now
  };

  let photoChanged = false;

  if (photoFile) {
    let newPhoto;
    try {
      newPhoto = await storeGuardPhoto(photoFile);
    } catch (error) {
      if (error instanceof GuardPhotoValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    nextGuard.photo_url = undefined;
    nextGuard.photo_file_id = newPhoto.photo_file_id;
    nextGuard.photo_filename = newPhoto.photo_filename;
    nextGuard.photo_mime_type = newPhoto.photo_mime_type;
    nextGuard.photo_size = newPhoto.photo_size;
    photoChanged = true;

    if (existing.photo_file_id) {
      await deleteGuardPhotoFields(existing).catch(() => undefined);
    }
  } else if (wantsPhotoRemoval) {
    nextGuard.photo_url = undefined;
    nextGuard.photo_file_id = undefined;
    nextGuard.photo_filename = undefined;
    nextGuard.photo_mime_type = undefined;
    nextGuard.photo_size = undefined;

    if (existing.photo_file_id) {
      await deleteGuardPhotoFields(existing).catch(() => undefined);
    }
  } else if (typeof parsed.data.photo_url === "string" && parsed.data.photo_url.trim()) {
    nextGuard.photo_url = parsed.data.photo_url.trim();
    nextGuard.photo_file_id = undefined;
    nextGuard.photo_filename = undefined;
    nextGuard.photo_mime_type = undefined;
    nextGuard.photo_size = undefined;
    photoChanged = true;

    if (existing.photo_file_id) {
      await deleteGuardPhotoFields(existing).catch(() => undefined);
    }
  }

  const normalizedExisting = normalizeGuardRecord(existing);
  const previewGuard = normalizeGuardRecord({
    ...existing,
    ...nextGuard,
  });
  const shouldSyncTerminalProfile = hasActiveEnrollment
    ? hasTerminalProfileChanges(normalizedExisting, previewGuard, photoChanged)
    : false;

  await guards.updateOne(
    { id },
    {
      $set: {
        ...nextGuard,
        person_type: previewGuard.person_type,
        person_role: previewGuard.person_role,
        gender: previewGuard.gender,
      }
    }
  );

  const updatedGuardDoc = await guards.findOne({ id });
  if (!updatedGuardDoc) {
    return NextResponse.json({ error: "Guard not found after update" }, { status: 404 });
  }

  const updatedGuard = normalizeGuardRecord(updatedGuardDoc);
  let terminalSync: Awaited<ReturnType<typeof syncGuardProfileToTerminals>> | null = null;

  if (hasActiveEnrollment && shouldSyncTerminalProfile) {
    terminalSync = await syncGuardProfileToTerminals({
      request,
      guard: updatedGuard,
      terminals: terminalDocs,
      enrollments: activeGuardEnrollments,
      rerunFaceEnrollment: photoChanged,
    });
  }

  const hydrated = await hydrateGuardWithTerminalValidation({
    guard: updatedGuard,
    terminals: terminalDocs,
    enrollments: await enrollments.find({ guard_id: id }).toArray(),
    persistCache: true,
  });

  return NextResponse.json({
    ...hydrated,
    terminal_sync: terminalSync
      ? {
          verified_count: terminalSync.summary?.verified_count || 0,
          total_terminals: terminalSync.summary?.total_terminals || 0,
          unknown_count: terminalSync.summary?.unknown_count || 0,
          failed_count: terminalSync.summary?.failed_count || 0,
          results: terminalSync.results,
        }
      : null,
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireSession(request);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const guards = await getGuardCollection();
  const existing = await guards.findOne({ id });

  if (!existing) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  if (existing.photo_file_id) {
    await deleteGuardPhotoFields(existing).catch(() => undefined);
  }

  const enrollments = await getCollection<GuardFaceEnrollment>("guard_face_enrollments");
  const terminals = await getCollection<Terminal>("terminals");
  const guardEnrollments = await enrollments.find({ guard_id: id }).toArray();
  const cleanupResults: Array<{
    terminal_id: string;
    status: GuardFaceEnrollment["status"];
    error?: string;
  }> = [];

  for (const enrollment of guardEnrollments) {
    const terminal = await terminals.findOne({ id: enrollment.terminal_id });
    if (!terminal) {
      cleanupResults.push({
        terminal_id: enrollment.terminal_id,
        status: "failed",
        error: "Terminal not found during guard deletion"
      });
      continue;
    }

    try {
      const client = new HikvisionClient(terminal);
      await client.deleteFace(resolveGuardFaceEnrollmentEmployeeNo(existing, enrollment));
      cleanupResults.push({ terminal_id: terminal.id, status: "removed" });
    } catch (error) {
      cleanupResults.push({
        terminal_id: enrollment.terminal_id,
        status: "failed",
        error: error instanceof Error ? error.message : "Face cleanup failed"
      });
    }
  }

  await enrollments.deleteMany({ guard_id: id }).catch(() => undefined);
  await getCollection<GuardAssignment>("guard_assignments")
    .then((collection) =>
      collection.updateMany(
        { guard_id: id, status: "active" },
        {
          $set: {
            status: "completed",
            end_date: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }
      )
    )
    .catch(() => undefined);
  await getCollection<Alert>("alerts")
    .then((collection) =>
      collection.updateMany(
        { guard_id: id, status: "open" },
        {
          $set: {
            status: "resolved",
            resolved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }
      )
    )
    .catch(() => undefined);

  const result = await guards.deleteOne({ id });

  if (result.deletedCount === 0) {
    return NextResponse.json({ error: "Guard not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, id, cleanup_results: cleanupResults });
}
