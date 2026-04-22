import { v4 as uuidv4 } from "uuid";
import { NextRequest } from "next/server";

import { syncGuardToTerminals, removeGuardFromTerminals } from "@/lib/guard-terminal-sync";
import { getCollection } from "@/lib/mongodb";
import { resolvePublicAppBaseUrl } from "@/lib/public-origin";
import { buildEmptyGuardTerminalValidation } from "@/lib/guard-terminal-state";
import { getShiftBlockForSlot, getSiteShiftScheduleCollection } from "@/lib/site-shifts";
import type {
  AssignmentTerminalSyncSummary,
  Guard,
  GuardAssignment,
  ShiftSlot,
  Site,
  SiteShiftSchedule,
  Terminal,
} from "@/lib/types";

export type GuardAssignmentTransitionPlan = {
  replace_current_assignment: boolean;
  remove_terminal_ids: string[];
  sync_terminal_ids: string[];
};

function isSuccessfulSyncStatus(status: string) {
  return status === "verified" || status === "synced";
}

function buildAssignmentTerminalSyncSummary(input: {
  previousTerminalCount: number;
  targetTerminalCount: number;
  removalResults?: Array<{ status: string }>;
  syncResults?: Array<{ status: string }>;
}): AssignmentTerminalSyncSummary {
  const removed_count =
    input.removalResults?.filter((result) => result.status === "removed").length || 0;
  const removal_failed_count =
    input.removalResults?.filter((result) => result.status === "failed").length || 0;
  const synced_count =
    input.syncResults?.filter((result) => isSuccessfulSyncStatus(result.status)).length || 0;
  const sync_failed_count =
    input.syncResults?.filter((result) => !isSuccessfulSyncStatus(result.status)).length || 0;

  let status: AssignmentTerminalSyncSummary["status"] = "not_required";
  if (
    input.previousTerminalCount > 0 ||
    input.targetTerminalCount > 0 ||
    input.removalResults?.length ||
    input.syncResults?.length
  ) {
    if (removal_failed_count === 0 && sync_failed_count === 0) {
      status = "ok";
    } else if (removed_count > 0 || synced_count > 0) {
      status = "partial";
    } else {
      status = "failed";
    }
  }

  return {
    status,
    previous_terminal_count: input.previousTerminalCount,
    target_terminal_count: input.targetTerminalCount,
    removed_count,
    removal_failed_count,
    synced_count,
    sync_failed_count,
    updated_at: new Date().toISOString(),
  };
}

export async function getGuardAssignmentCollection() {
  return getCollection<GuardAssignment>("guard_assignments");
}

export function planGuardAssignmentTransition(input: {
  currentAssignment?: Pick<GuardAssignment, "site_id" | "shift_slot"> | null;
  nextSiteId: string;
  nextShiftSlot: ShiftSlot;
  terminals: Array<Pick<Terminal, "id" | "site_id">>;
}): GuardAssignmentTransitionPlan {
  const { currentAssignment, nextSiteId, nextShiftSlot, terminals } = input;

  if (!currentAssignment) {
    return {
      replace_current_assignment: false,
      remove_terminal_ids: [],
      sync_terminal_ids: terminals
        .filter((terminal) => terminal.site_id === nextSiteId)
        .map((terminal) => terminal.id),
    };
  }

  if (
    currentAssignment.site_id === nextSiteId &&
    currentAssignment.shift_slot === nextShiftSlot
  ) {
    return {
      replace_current_assignment: false,
      remove_terminal_ids: [],
      sync_terminal_ids: [],
    };
  }

  return {
    replace_current_assignment: true,
    remove_terminal_ids:
      currentAssignment.site_id === nextSiteId
        ? []
        : terminals
            .filter((terminal) => terminal.site_id === currentAssignment.site_id)
            .map((terminal) => terminal.id),
    sync_terminal_ids:
      currentAssignment.site_id === nextSiteId
        ? []
        : terminals
            .filter((terminal) => terminal.site_id === nextSiteId)
            .map((terminal) => terminal.id),
  };
}

export async function hydrateGuardAssignments(
  assignments: GuardAssignment[],
  options?: {
    sites?: Site[];
    schedules?: SiteShiftSchedule[];
  }
) {
  const siteIds = [...new Set(assignments.map((assignment) => assignment.site_id))];
  const [sites, schedules] = await Promise.all([
    options?.sites
      ? Promise.resolve(options.sites)
      : siteIds.length > 0
        ? getCollection<Site>("sites").then((collection) =>
            collection.find({ id: { $in: siteIds } }).toArray()
          )
        : Promise.resolve([]),
    options?.schedules
      ? Promise.resolve(options.schedules)
      : siteIds.length > 0
        ? getSiteShiftScheduleCollection().then((collection) =>
            collection.find({ site_id: { $in: siteIds } }).toArray()
          )
        : Promise.resolve([]),
  ]);

  const siteById = new Map(sites.map((site) => [site.id, site]));
  const scheduleBySiteId = new Map(
    schedules.map((schedule) => [schedule.site_id, schedule])
  );

  return assignments.map((assignment) => ({
    ...assignment,
    site: siteById.get(assignment.site_id),
    site_shift_schedule: scheduleBySiteId.get(assignment.site_id),
  }));
}

export async function listActiveGuardAssignments(options?: {
  guardIds?: string[];
  hydrate?: boolean;
}) {
  const assignments = await getGuardAssignmentCollection();
  const query: Record<string, unknown> = { status: "active" };
  if (options?.guardIds?.length) {
    query.guard_id = { $in: options.guardIds };
  }

  const docs = await assignments.find(query).toArray();
  if (!options?.hydrate) {
    return docs;
  }

  return hydrateGuardAssignments(docs);
}

export async function getActiveGuardAssignment(
  guardId: string,
  options?: { hydrate?: boolean }
) {
  const assignments = await getGuardAssignmentCollection();
  const assignment = await assignments.findOne({
    guard_id: guardId,
    status: "active",
  });

  if (!assignment) {
    return null;
  }

  if (!options?.hydrate) {
    return assignment;
  }

  const [hydrated] = await hydrateGuardAssignments([assignment]);
  return hydrated || null;
}

export async function assignGuardToSiteShift(options: {
  request: NextRequest;
  guardId: string;
  siteId: string;
  shiftSlot: ShiftSlot;
}) {
  const [guards, sites, terminals, schedules, assignments] = await Promise.all([
    getCollection<Guard>("guards"),
    getCollection<Site>("sites"),
    getCollection<Terminal>("terminals"),
    getSiteShiftScheduleCollection(),
    getGuardAssignmentCollection(),
  ]);

  const [guard, site, schedule, terminalDocs, currentAssignment] = await Promise.all([
    guards.findOne({ id: options.guardId }),
    sites.findOne({ id: options.siteId }),
    schedules.findOne({ site_id: options.siteId }),
    terminals.find({}).sort({ name: 1 }).toArray(),
    assignments.findOne({ guard_id: options.guardId, status: "active" }),
  ]);

  if (!guard) {
    throw new Error("Guard not found");
  }

  if (!site) {
    throw new Error("Site not found");
  }

  if (!schedule) {
    throw new Error("Set up the site shift schedule before assigning guards.");
  }

  const shiftBlock = getShiftBlockForSlot(schedule, options.shiftSlot);
  if (!shiftBlock) {
    throw new Error(
      options.shiftSlot === "night"
        ? "Night shift is not enabled for this site."
        : "Day shift configuration is missing for this site."
    );
  }

  const transition = planGuardAssignmentTransition({
    currentAssignment,
    nextSiteId: options.siteId,
    nextShiftSlot: options.shiftSlot,
    terminals: terminalDocs,
  });

  if (
    currentAssignment &&
    !transition.replace_current_assignment &&
    transition.remove_terminal_ids.length === 0 &&
    transition.sync_terminal_ids.length === 0
  ) {
    const [hydrated] = await hydrateGuardAssignments([currentAssignment], {
      sites: [site],
      schedules: [schedule],
    });
    return {
      assignment: hydrated || currentAssignment,
      changed: false,
    };
  }

  const removalTerminals = terminalDocs.filter((terminal) =>
    transition.remove_terminal_ids.includes(terminal.id)
  );
  const syncTerminals = terminalDocs.filter((terminal) =>
    transition.sync_terminal_ids.includes(terminal.id)
  );

  let publicBaseUrl: string | null = null;
  if (syncTerminals.length > 0) {
    publicBaseUrl = resolvePublicAppBaseUrl(options.request.url, options.request.headers);
  }

  const [removalResult, syncResult] = await Promise.all([
    removalTerminals.length > 0
      ? removeGuardFromTerminals({
          guard,
          terminals: removalTerminals,
        })
      : Promise.resolve(null),
    syncTerminals.length > 0 && publicBaseUrl
      ? syncGuardToTerminals({
          guard,
          terminals: syncTerminals,
          validationTerminals: syncTerminals,
          publicBaseUrl,
        })
      : Promise.resolve(null),
  ]);

  const terminalSyncSummary = buildAssignmentTerminalSyncSummary({
    previousTerminalCount: removalTerminals.length,
    targetTerminalCount: syncTerminals.length,
    removalResults: removalResult?.results,
    syncResults: syncResult?.results,
  });
  const terminalValidationSummary =
    syncResult?.terminal_validation || buildEmptyGuardTerminalValidation();

  const now = new Date().toISOString();
  if (currentAssignment) {
    await assignments.updateOne(
      { id: currentAssignment.id },
      {
        $set: {
          status: "replaced",
          end_date: now,
          updated_at: now,
        },
      }
    );
  }

  const nextAssignment: GuardAssignment = {
    id: uuidv4(),
    guard_id: guard.id,
    site_id: site.id,
    shift_slot: options.shiftSlot,
    effective_date: now,
    status: "active",
    terminal_sync: terminalSyncSummary,
    created_at: now,
    updated_at: now,
  };

  await assignments.insertOne({ ...nextAssignment, _id: nextAssignment.id } as never);

  const [hydratedAssignment] = await hydrateGuardAssignments([nextAssignment], {
    sites: [site],
    schedules: [schedule],
  });

  return {
    assignment: hydratedAssignment || nextAssignment,
    changed: true,
    terminal_sync: {
      summary: terminalSyncSummary,
    },
    terminal_validation: {
      verified_count: terminalValidationSummary.verified_count,
      total_terminals: terminalValidationSummary.total_terminals,
      unknown_count: terminalValidationSummary.unknown_count,
      failed_count: terminalValidationSummary.failed_count,
    },
  };
}
