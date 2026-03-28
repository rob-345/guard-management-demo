import { createHash } from "crypto";
import type { Collection } from "mongodb";

import type { Guard, GuardFaceEnrollment } from "./types";

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function buildGuardFaceEmployeeNoCandidates(employeeNo: string) {
  const normalized = employeeNo.trim();
  const compact = normalized.replace(/[^A-Za-z0-9]/g, "");
  const hash = createHash("sha1").update(normalized || "guard-face").digest("hex");
  const hexFallback = `g${hash.slice(0, 31)}`;
  const numericFallback = Number.parseInt(hash.slice(0, 12), 16).toString();

  return uniqueStrings([normalized, compact, hexFallback, numericFallback].filter((value) => value.length <= 32));
}

export function resolveGuardFaceEnrollmentEmployeeNo(
  guard: Pick<Guard, "employee_number" | "id">,
  enrollment?: Pick<GuardFaceEnrollment, "device_employee_no"> | null
) {
  return enrollment?.device_employee_no || buildGuardFaceEmployeeNoCandidates(guard.employee_number)[0] || guard.employee_number.trim();
}

export async function recomputeGuardFaceSyncState(
  enrollments: Collection<GuardFaceEnrollment>,
  guardId: string
) {
  const docs = await enrollments
    .find({
      guard_id: guardId,
      status: { $in: ["pending", "syncing", "failed", "synced", "removing"] }
    })
    .toArray();

  const hasSynced = docs.some((doc) => doc.status === "synced");
  const hasOutstanding = docs.some(
    (doc) => doc.status === "pending" || doc.status === "syncing" || doc.status === "failed" || doc.status === "removing"
  );

  return hasSynced && !hasOutstanding;
}

export async function summarizeGuardFaceEnrollments(
  enrollments: Collection<GuardFaceEnrollment>,
  guardId: string
) {
  const docs = await enrollments.find({ guard_id: guardId }).toArray();
  const summary = {
    total: docs.length,
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
    removing: 0,
    removed: 0
  };

  for (const doc of docs) {
    if (doc.status in summary) {
      summary[doc.status as keyof typeof summary] += 1;
    }
  }

  return {
    ...summary,
    facial_imprint_synced: summary.synced > 0 && summary.pending === 0 && summary.syncing === 0 && summary.failed === 0 && summary.removing === 0
  };
}

export async function resolveGuardByEmployeeNo(
  guards: Collection<Guard>,
  enrollments: Collection<GuardFaceEnrollment>,
  employeeNo: string,
  terminalId?: string
) {
  const directMatch = await guards.findOne({ employee_number: employeeNo });
  if (directMatch) {
    return directMatch;
  }

  const enrollmentFilters: Array<Record<string, unknown>> = [];
  if (terminalId) {
    enrollmentFilters.push({ terminal_id: terminalId, device_employee_no: employeeNo });
  }
  enrollmentFilters.push({ device_employee_no: employeeNo });

  for (const filter of enrollmentFilters) {
    const enrollment = await enrollments.findOne({
      ...filter,
      status: { $in: ["synced", "syncing", "failed", "pending", "removing"] }
    });

    if (enrollment) {
      const guard = await guards.findOne({ id: enrollment.guard_id });
      if (guard) {
        return guard;
      }
    }
  }

  return null;
}
