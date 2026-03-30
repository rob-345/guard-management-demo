import assert from "node:assert/strict";
import test from "node:test";

import { planGuardAssignmentTransition } from "@/lib/guard-assignments";

const terminals = [
  { id: "t-1", site_id: "site-a" },
  { id: "t-2", site_id: "site-a" },
  { id: "t-3", site_id: "site-b" },
];

test("planGuardAssignmentTransition syncs target site terminals for a first assignment", () => {
  const plan = planGuardAssignmentTransition({
    currentAssignment: null,
    nextSiteId: "site-a",
    nextShiftSlot: "day",
    terminals,
  });

  assert.equal(plan.replace_current_assignment, false);
  assert.deepEqual(plan.remove_terminal_ids, []);
  assert.deepEqual(plan.sync_terminal_ids, ["t-1", "t-2"]);
});

test("planGuardAssignmentTransition is a no-op for the same site and shift slot", () => {
  const plan = planGuardAssignmentTransition({
    currentAssignment: { site_id: "site-a", shift_slot: "day" },
    nextSiteId: "site-a",
    nextShiftSlot: "day",
    terminals,
  });

  assert.equal(plan.replace_current_assignment, false);
  assert.deepEqual(plan.remove_terminal_ids, []);
  assert.deepEqual(plan.sync_terminal_ids, []);
});

test("planGuardAssignmentTransition replaces the assignment and diffs terminals on a site move", () => {
  const plan = planGuardAssignmentTransition({
    currentAssignment: { site_id: "site-a", shift_slot: "day" },
    nextSiteId: "site-b",
    nextShiftSlot: "night",
    terminals,
  });

  assert.equal(plan.replace_current_assignment, true);
  assert.deepEqual(plan.remove_terminal_ids, ["t-1", "t-2"]);
  assert.deepEqual(plan.sync_terminal_ids, ["t-3"]);
});

test("planGuardAssignmentTransition replaces the assignment without terminal movement on a slot change", () => {
  const plan = planGuardAssignmentTransition({
    currentAssignment: { site_id: "site-a", shift_slot: "day" },
    nextSiteId: "site-a",
    nextShiftSlot: "night",
    terminals,
  });

  assert.equal(plan.replace_current_assignment, true);
  assert.deepEqual(plan.remove_terminal_ids, []);
  assert.deepEqual(plan.sync_terminal_ids, []);
});
