import type { Collection } from "mongodb";

import { HikvisionClient, type HikvisionUserInfoInput } from "@/lib/hikvision";
import type {
  Guard,
  GuardFaceEnrollment,
  GuardTerminalValidation,
  GuardTerminalValidationSummary,
  GuardTerminalValidationStatus,
  Terminal,
} from "@/lib/types";

import { resolveGuardFaceEnrollmentEmployeeNo } from "./guard-face";

export const PERSON_ROLE_EXTENSION_NAME = "personRole";
export const DEFAULT_GUARD_PERSON_TYPE: Guard["person_type"] = "normal";
export const DEFAULT_GUARD_PERSON_ROLE: Guard["person_role"] = "Guard";
export const DEFAULT_GUARD_GENDER: Guard["gender"] = "unknown";

function activeEnrollments(enrollments: GuardFaceEnrollment[]) {
  return enrollments.filter((enrollment) => enrollment.status !== "removed");
}

function buildRoleExtension(value: Guard["person_role"]) {
  return [
    {
      id: 1,
      enable: true,
      name: PERSON_ROLE_EXTENSION_NAME,
      value,
    },
  ];
}

export function buildGuardTerminalUserInfo(guard: Pick<Guard, "person_type" | "person_role" | "gender" | "phone_number">): HikvisionUserInfoInput {
  return {
    userType: guard.person_type,
    phoneNumber: guard.phone_number,
    gender: guard.gender === "unknown" ? undefined : guard.gender,
    personInfoExtends: buildRoleExtension(guard.person_role),
  };
}

export function buildEmptyGuardTerminalValidation(): GuardTerminalValidationSummary {
  return {
    verified_count: 0,
    total_terminals: 0,
    unknown_count: 0,
    failed_count: 0,
    validations: [],
  };
}

export function normalizeGuardRecord(
  guard: Partial<Guard> & Pick<Guard, "id" | "employee_number" | "full_name" | "phone_number" | "status" | "created_at" | "updated_at">
): Guard {
  return {
    ...guard,
    person_type: guard.person_type || DEFAULT_GUARD_PERSON_TYPE,
    person_role: guard.person_role || DEFAULT_GUARD_PERSON_ROLE,
    gender: guard.gender || DEFAULT_GUARD_GENDER,
    facial_imprint_synced: Boolean(guard.facial_imprint_synced),
  } as Guard;
}

export function withGuardTerminalValidation(
  guard: Guard,
  terminalValidation: GuardTerminalValidationSummary,
  hasTerminalEnrollment = terminalValidation.total_terminals > 0
): Guard {
  return {
    ...guard,
    has_terminal_enrollment: hasTerminalEnrollment,
    terminal_validation: terminalValidation,
    facial_imprint_synced:
      terminalValidation.total_terminals > 0 &&
      terminalValidation.verified_count === terminalValidation.total_terminals,
  };
}

export function summarizeGuardTerminalValidation(validations: GuardTerminalValidation[]): GuardTerminalValidationSummary {
  const verified_count = validations.filter((validation) => validation.status === "verified").length;
  const unknown_count = validations.filter((validation) => validation.status === "terminal_unreachable").length;
  const failed_count = validations.length - verified_count - unknown_count;

  return {
    verified_count,
    total_terminals: validations.length,
    unknown_count,
    failed_count,
    validations,
  };
}

function mapSdkValidationStatus(status: string): GuardTerminalValidationStatus {
  switch (status) {
    case "verified":
    case "face_missing":
    case "user_missing":
    case "details_mismatch":
    case "terminal_unreachable":
    case "validation_error":
      return status;
    default:
      return "validation_error";
  }
}

export async function validateGuardOnTerminal(options: {
  guard: Guard;
  terminal: Terminal;
  enrollment?: GuardFaceEnrollment | null;
}): Promise<GuardTerminalValidation> {
  const { guard, terminal, enrollment } = options;
  const employeeNo = resolveGuardFaceEnrollmentEmployeeNo(guard, enrollment);
  const validated_at = new Date().toISOString();

  const client = new HikvisionClient(terminal);
  const result = await client.validateUserState({
    employeeNo,
    name: guard.full_name,
    phoneNumber: guard.phone_number,
    gender: guard.gender,
    userType: guard.person_type,
    personRole: guard.person_role,
    requireFace: true,
  });

  return {
    terminal_id: terminal.id,
    terminal_name: terminal.name,
    terminal_ip_address: terminal.ip_address,
    status: mapSdkValidationStatus(result.status),
    face_present: result.facePresent,
    user_present: result.userPresent,
    details_match: result.detailsMatch,
    access_ready: result.accessReady,
    error: result.error,
    employee_no: result.employeeNo,
    mismatches: result.mismatches,
    validated_at,
  };
}

async function persistValidationCache(options: {
  guard: Guard;
  validations: GuardTerminalValidation[];
  enrollments: GuardFaceEnrollment[];
  enrollmentCollection: Collection<GuardFaceEnrollment>;
  guardCollection?: Collection<Guard>;
}) {
  const { guard, validations, enrollments, enrollmentCollection, guardCollection } = options;
  const enrollmentByTerminalId = new Map(enrollments.map((enrollment) => [enrollment.terminal_id, enrollment]));

  for (const validation of validations) {
    const enrollment = enrollmentByTerminalId.get(validation.terminal_id);
    if (!enrollment) {
      continue;
    }

    const nextStatus =
      validation.status === "verified"
        ? "synced"
        : validation.status === "terminal_unreachable"
          ? enrollment.status
          : "failed";

    const setPayload: Record<string, unknown> = {
      status: nextStatus,
      last_verified_at: validation.validated_at,
      last_verified_state: validation.status,
      updated_at: validation.validated_at,
      ...(validation.status === "verified" ? { synced_at: validation.validated_at } : {}),
    };

    if (validation.error) {
      setPayload.error = validation.error;
      setPayload.last_validation_error = validation.error;
    }

    await enrollmentCollection.updateOne(
      { guard_id: guard.id, terminal_id: validation.terminal_id },
      {
        $set: setPayload,
        $unset: validation.status === "verified"
          ? {
              error: "",
              last_validation_error: "",
            }
          : {},
      }
    );
  }

  if (guardCollection) {
    const summary = summarizeGuardTerminalValidation(validations);
    await guardCollection.updateOne(
      { id: guard.id },
      {
        $set: {
          facial_imprint_synced:
            summary.total_terminals > 0 &&
            summary.verified_count === summary.total_terminals,
          updated_at: new Date().toISOString(),
        },
      }
    );
  }
}

export async function validateGuardAcrossTerminals(options: {
  guard: Guard;
  terminals: Terminal[];
  enrollments: GuardFaceEnrollment[];
  expectedTerminals?: Terminal[];
  enrollmentCollection?: Collection<GuardFaceEnrollment>;
  guardCollection?: Collection<Guard>;
  persistCache?: boolean;
}) {
  const active = activeEnrollments(options.enrollments);
  if (active.length === 0 && (!options.expectedTerminals || options.expectedTerminals.length === 0)) {
    return buildEmptyGuardTerminalValidation();
  }

  const terminalsById = new Map(options.terminals.map((terminal) => [terminal.id, terminal]));
  const enrollmentByTerminalId = new Map(
    active.map((enrollment) => [enrollment.terminal_id, enrollment])
  );
  const terminalsToValidate = options.expectedTerminals
    ? options.expectedTerminals
    : active
        .map((enrollment) => terminalsById.get(enrollment.terminal_id))
        .filter((terminal): terminal is Terminal => Boolean(terminal));

  const validations = await Promise.all(
    terminalsToValidate.map(async (terminal) => {
      const enrollment = enrollmentByTerminalId.get(terminal.id);
      if (!enrollment && options.expectedTerminals) {
        return {
          terminal_id: terminal.id,
          terminal_name: terminal.name,
          terminal_ip_address: terminal.ip_address,
          status: "validation_error" as const,
          face_present: false,
          user_present: false,
          details_match: false,
          access_ready: false,
          error: "Guard is not enrolled on this assigned site terminal",
          validated_at: new Date().toISOString(),
        };
      }

      if (!enrollment) {
        return {
          terminal_id: terminal.id,
          terminal_name: terminal.name,
          terminal_ip_address: terminal.ip_address,
          status: "validation_error" as const,
          face_present: false,
          user_present: false,
          details_match: false,
          access_ready: false,
          error: "Terminal enrollment record not found",
          validated_at: new Date().toISOString(),
        };
      }

      return validateGuardOnTerminal({
        guard: normalizeGuardRecord(options.guard),
        terminal,
        enrollment,
      });
    })
  );

  for (const enrollment of active) {
    if (terminalsToValidate.some((terminal) => terminal.id === enrollment.terminal_id)) {
      continue;
    }

    const terminal = terminalsById.get(enrollment.terminal_id);
    validations.push({
      terminal_id: enrollment.terminal_id,
      terminal_name: terminal?.name,
      terminal_ip_address: terminal?.ip_address,
      status: "validation_error" as const,
      face_present: false,
      user_present: false,
      details_match: false,
      access_ready: false,
      error: terminal ? "Terminal is outside the assigned site" : "Terminal not found",
      employee_no: enrollment.device_employee_no,
      validated_at: new Date().toISOString(),
    });
  }

  if (options.persistCache && options.enrollmentCollection) {
    await persistValidationCache({
      guard: options.guard,
      validations,
      enrollments: active,
      enrollmentCollection: options.enrollmentCollection,
      guardCollection: options.guardCollection,
    });
  }

  return summarizeGuardTerminalValidation(validations);
}
