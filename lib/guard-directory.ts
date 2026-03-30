import { getCollection } from "@/lib/mongodb";
import type { Guard, GuardAssignment, GuardFaceEnrollment, Terminal } from "@/lib/types";
import { getActiveGuardAssignment, listActiveGuardAssignments } from "./guard-assignments";

import {
  buildEmptyGuardTerminalValidation,
  normalizeGuardRecord,
  validateGuardAcrossTerminals,
  withGuardTerminalValidation,
} from "./guard-terminal-state";

async function getGuardCollections() {
  const [guards, terminals, enrollments] = await Promise.all([
    getCollection<Guard>("guards"),
    getCollection<Terminal>("terminals"),
    getCollection<GuardFaceEnrollment>("guard_face_enrollments"),
  ]);

  return { guards, terminals, enrollments };
}

export async function hydrateGuardWithTerminalValidation(options: {
  guard: Guard;
  terminals?: Terminal[];
  enrollments?: GuardFaceEnrollment[];
  assignment?: GuardAssignment | null;
  persistCache?: boolean;
}) {
  const {
    terminals: providedTerminals,
    enrollments: providedEnrollments,
    assignment: providedAssignment,
    persistCache = false,
  } = options;
  const { guards, terminals: terminalCollection, enrollments: enrollmentCollection } = await getGuardCollections();

  const [terminals, enrollments, assignment] = await Promise.all([
    providedTerminals ? Promise.resolve(providedTerminals) : terminalCollection.find({}).toArray(),
    providedEnrollments
      ? Promise.resolve(providedEnrollments)
      : enrollmentCollection.find({ guard_id: options.guard.id }).toArray(),
    providedAssignment !== undefined
      ? Promise.resolve(providedAssignment)
      : getActiveGuardAssignment(options.guard.id, { hydrate: true }),
  ]);

  const normalizedGuard = normalizeGuardRecord(options.guard);
  const expectedTerminals = assignment
    ? terminals.filter((terminal) => terminal.site_id === assignment.site_id)
    : undefined;
  const summary =
    (expectedTerminals && expectedTerminals.length > 0) || enrollments.length > 0
      ? await validateGuardAcrossTerminals({
          guard: normalizedGuard,
          terminals,
          enrollments,
          expectedTerminals,
          enrollmentCollection,
          guardCollection: guards,
          persistCache,
        })
      : buildEmptyGuardTerminalValidation();

  return {
    ...withGuardTerminalValidation(
      normalizedGuard,
      summary,
      assignment ? expectedTerminals?.length !== 0 : enrollments.some((entry) => entry.status !== "removed")
    ),
    current_assignment: assignment || undefined,
  };
}

export async function listGuardsWithTerminalValidation(options?: {
  persistCache?: boolean;
}) {
  const { guards, terminals, enrollments } = await getGuardCollections();
  const [guardDocs, terminalDocs, enrollmentDocs] = await Promise.all([
    guards.find({}).sort({ full_name: 1 }).toArray(),
    terminals.find({}).sort({ name: 1 }).toArray(),
    enrollments.find({}).toArray(),
  ]);
  const activeAssignments = await listActiveGuardAssignments({
    guardIds: guardDocs.map((guard) => guard.id),
    hydrate: true,
  });

  const enrollmentsByGuardId = new Map<string, GuardFaceEnrollment[]>();
  for (const enrollment of enrollmentDocs) {
    const current = enrollmentsByGuardId.get(enrollment.guard_id) || [];
    current.push(enrollment);
    enrollmentsByGuardId.set(enrollment.guard_id, current);
  }
  const assignmentByGuardId = new Map(
    activeAssignments.map((assignment) => [assignment.guard_id, assignment])
  );

  return Promise.all(
    guardDocs.map((guard) =>
      hydrateGuardWithTerminalValidation({
        guard,
        terminals: terminalDocs,
        enrollments: enrollmentsByGuardId.get(guard.id) || [],
        assignment: assignmentByGuardId.get(guard.id) || null,
        persistCache: options?.persistCache,
      })
    )
  );
}
