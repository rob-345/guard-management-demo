import { v4 as uuidv4 } from "uuid";
import type { Collection } from "mongodb";

import { resolveGuardFaceEnrollmentEmployeeNo, summarizeGuardFaceEnrollments } from "@/lib/guard-face";
import { buildGuardPhotoUrl } from "@/lib/guard-photo-access";
import { loadGuardPhoto } from "@/lib/guard-media";
import {
  buildGuardTerminalUserInfo,
  normalizeGuardRecord,
  validateGuardAcrossTerminals,
} from "@/lib/guard-terminal-state";
import { HikvisionClient } from "@/lib/hikvision";
import { getCollection } from "@/lib/mongodb";
import type { Guard, GuardFaceEnrollment, Terminal } from "@/lib/types";

type TerminalMutationResult = {
  terminal_id: string;
  status: string;
  already_present?: boolean;
  error?: string;
  face_present?: boolean;
  user_present?: boolean;
  details_match?: boolean;
  access_ready?: boolean;
  validated_at?: string;
  mismatches?: string[];
};

async function upsertEnrollment(
  enrollmentCollection: Collection<GuardFaceEnrollment>,
  enrollment: GuardFaceEnrollment
) {
  const setPayload: Record<string, unknown> = {
    id: enrollment.id,
    guard_id: enrollment.guard_id,
    terminal_id: enrollment.terminal_id,
    status: enrollment.status,
    created_at: enrollment.created_at,
    updated_at: enrollment.updated_at,
  };

  if (enrollment.device_employee_no) {
    setPayload.device_employee_no = enrollment.device_employee_no;
  }

  if (enrollment.error) {
    setPayload.error = enrollment.error;
    setPayload.last_validation_error = enrollment.error;
  }

  if (enrollment.synced_at) {
    setPayload.synced_at = enrollment.synced_at;
  }

  if (enrollment.last_verified_at) {
    setPayload.last_verified_at = enrollment.last_verified_at;
  }

  if (enrollment.last_verified_state) {
    setPayload.last_verified_state = enrollment.last_verified_state;
  }

  const unsetPayload: Record<string, "" | 1> = {};
  if (!enrollment.error) {
    unsetPayload.error = "";
    unsetPayload.last_validation_error = "";
  }
  if (!enrollment.synced_at) {
    unsetPayload.synced_at = "";
  }

  await enrollmentCollection.updateOne(
    { guard_id: enrollment.guard_id, terminal_id: enrollment.terminal_id },
    {
      $set: setPayload,
      ...(Object.keys(unsetPayload).length > 0 ? { $unset: unsetPayload } : {}),
    },
    { upsert: true }
  );
}

export async function syncGuardToTerminals(options: {
  guard: Guard;
  terminals: Terminal[];
  validationTerminals?: Terminal[];
  publicBaseUrl: string;
}) {
  const { guard, terminals, validationTerminals = terminals, publicBaseUrl } = options;
  const guards = await getCollection<Guard>("guards");
  const enrollments = await getCollection<GuardFaceEnrollment>("guard_face_enrollments");
  const existingEnrollments = await enrollments.find({ guard_id: guard.id }).toArray();
  const existingEnrollmentByTerminalId = new Map(
    existingEnrollments.map((enrollment) => [enrollment.terminal_id, enrollment])
  );

  const normalizedGuard = normalizeGuardRecord(guard);
  const photo = await loadGuardPhoto(normalizedGuard);
  const userInfo = buildGuardTerminalUserInfo(normalizedGuard);
  const results: TerminalMutationResult[] = [];

  for (const terminal of terminals) {
    const existingEnrollment = existingEnrollmentByTerminalId.get(terminal.id);
    const enrollmentEmployeeNo = resolveGuardFaceEnrollmentEmployeeNo(
      normalizedGuard,
      existingEnrollment
    );

    const enrollmentBase: GuardFaceEnrollment = {
      id: existingEnrollment?.id || uuidv4(),
      guard_id: normalizedGuard.id,
      terminal_id: terminal.id,
      device_employee_no: enrollmentEmployeeNo,
      status: "syncing",
      created_at: existingEnrollment?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await upsertEnrollment(enrollments, enrollmentBase);

    try {
      const client = new HikvisionClient(terminal);
      const faceUrl = buildGuardPhotoUrl(publicBaseUrl, normalizedGuard, terminal);
      const registration = await client.registerFace({
        employeeNo: enrollmentEmployeeNo,
        name: normalizedGuard.full_name,
        faceUrl,
        image: photo.buffer,
        filename: photo.filename,
        mimeType: photo.mimeType,
        userInfo,
      });

      await upsertEnrollment(enrollments, {
        ...enrollmentBase,
        status: "syncing",
        device_employee_no: registration.employeeNo,
        updated_at: new Date().toISOString(),
      });

      results.push({
        terminal_id: terminal.id,
        status: "syncing",
        already_present: Boolean(registration.alreadyPresent),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Face sync failed";
      await upsertEnrollment(enrollments, {
        ...enrollmentBase,
        status: "failed",
        error: message,
        updated_at: new Date().toISOString(),
      });
      results.push({
        terminal_id: terminal.id,
        status: "failed",
        error: message,
      });
    }
  }

  const refreshedEnrollments = await enrollments.find({ guard_id: normalizedGuard.id }).toArray();
  const summary = await validateGuardAcrossTerminals({
    guard: normalizedGuard,
    terminals: validationTerminals,
    enrollments: refreshedEnrollments,
    enrollmentCollection: enrollments,
    guardCollection: guards,
    persistCache: true,
  });

  const validationByTerminalId = new Map(
    summary.validations.map((validation) => [validation.terminal_id, validation])
  );

  const mergedResults = results.map((result) => {
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
      mismatches: validation.mismatches,
      validated_at: validation.validated_at,
    };
  });

  return {
    guard_id: normalizedGuard.id,
    results: mergedResults,
    summary: {
      facial_imprint_synced:
        summary.total_terminals > 0 &&
        summary.verified_count === summary.total_terminals,
      synced_count: summary.verified_count,
      failed_count: summary.failed_count,
      pending_count: 0,
      total_terminals: summary.total_terminals,
      unknown_count: summary.unknown_count,
    },
    terminal_validation: summary,
    facial_imprint_synced:
      summary.total_terminals > 0 &&
      summary.verified_count === summary.total_terminals,
  };
}

export async function removeGuardFromTerminals(options: {
  guard: Guard;
  terminals: Terminal[];
}) {
  const guards = await getCollection<Guard>("guards");
  const enrollments = await getCollection<GuardFaceEnrollment>("guard_face_enrollments");
  const results: Array<{
    terminal_id: string;
    status: GuardFaceEnrollment["status"];
    error?: string;
  }> = [];

  for (const terminal of options.terminals) {
    const existing = await enrollments.findOne({
      guard_id: options.guard.id,
      terminal_id: terminal.id,
    });

    if (!existing) {
      results.push({ terminal_id: terminal.id, status: "removed" });
      continue;
    }

    const removingAt = new Date().toISOString();
    const employeeNo = resolveGuardFaceEnrollmentEmployeeNo(options.guard, existing);
    await enrollments.updateOne(
      { guard_id: options.guard.id, terminal_id: terminal.id },
      {
        $set: {
          status: "removing",
          updated_at: removingAt,
        },
      }
    );

    try {
      const client = new HikvisionClient(terminal);
      await client.deleteFace(employeeNo);

      await enrollments.updateOne(
        { guard_id: options.guard.id, terminal_id: terminal.id },
        {
          $set: {
            status: "removed",
            removed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        }
      );

      results.push({ terminal_id: terminal.id, status: "removed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Face removal failed";
      await enrollments.updateOne(
        { guard_id: options.guard.id, terminal_id: terminal.id },
        {
          $set: {
            status: "failed",
            error: message,
            updated_at: new Date().toISOString(),
          },
        }
      );

      results.push({
        terminal_id: terminal.id,
        status: "failed",
        error: message,
      });
    }
  }

  const summary = await summarizeGuardFaceEnrollments(enrollments, options.guard.id);
  await guards.updateOne(
    { id: options.guard.id },
    {
      $set: {
        facial_imprint_synced: summary.facial_imprint_synced,
        updated_at: new Date().toISOString(),
      },
    }
  );

  return {
    guard_id: options.guard.id,
    results,
    summary,
    facial_imprint_synced: summary.facial_imprint_synced,
  };
}
