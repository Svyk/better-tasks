// TZ must be set before any Date is constructed, hence a separate test file.
process.env.TZ = "Australia/Melbourne";

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, startOfDay, subtractDays, addDays } from "../src/core/filters.js";

// Melbourne DST ends Sun 5 Apr 2026 (25-hour day) and starts Sun 4 Oct 2026 (23-hour day).
const DAY_MS = 24 * 60 * 60 * 1000;

test("the test process really is in a DST-observing timezone", () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "Australia/Melbourne");
  const jan = new Date(2026, 0, 15).getTimezoneOffset();
  const jul = new Date(2026, 6, 15).getTimezoneOffset();
  assert.notEqual(jan, jul, "expected a DST offset change between January and July");
});

test("subtractDays stays at midnight across the DST-end boundary; ms arithmetic does not", () => {
  const start = startOfDay(new Date(2026, 3, 8)); // Wed 8 Apr 2026, after DST ended on the 5th
  const calendar = subtractDays(start, 14);
  const msMath = new Date(start.getTime() - 14 * DAY_MS);

  assert.equal(calendar.getHours(), 0, "calendar subtraction lands on midnight");
  assert.equal(calendar.getDate(), 25);
  assert.equal(calendar.getMonth(), 2); // March

  assert.equal(msMath.getHours(), 1, "ms arithmetic drifts an hour — this was the bug");
});

test("addDays stays at midnight across the DST-start boundary; ms arithmetic does not", () => {
  const start = startOfDay(new Date(2026, 8, 20)); // Sun 20 Sep 2026, before DST began on 4 Oct
  const calendar = addDays(start, 30);
  const msMath = new Date(start.getTime() + 30 * DAY_MS);

  assert.equal(calendar.getHours(), 0);
  assert.equal(msMath.getHours(), 1, "ms arithmetic drifts an hour forward");
});

test("stalled classification is stable across a DST boundary", () => {
  // 8 Apr 2026, 14-day threshold → midnight on 25 Mar. A task edited at 00:30 on
  // 25 Mar is active; one edited at 23:30 on 24 Mar is stalled. Under the old
  // millisecond arithmetic the threshold sat at 01:00, flipping the first task.
  const now = new Date(2026, 3, 8, 10, 0, 0);
  const mk = (uid, editedAt) => ({
    uid, title: "t", text: "t", pageTitle: "", isCompleted: false, isBlocked: false,
    completedAt: null, dueAt: null, editedAt: editedAt.getTime(), metadata: {},
  });
  const justAfterBoundary = mk("active", new Date(2026, 2, 25, 0, 30, 0));
  const justBeforeBoundary = mk("stalled", new Date(2026, 2, 24, 23, 30, 0));
  const tasks = [justAfterBoundary, justBeforeBoundary];

  const stalled = applyFilters(tasks, { Stalled: ["stalled"] }, "", { now }).map((t) => t.uid);
  const active = applyFilters(tasks, { Stalled: ["active"] }, "", { now }).map((t) => t.uid);

  assert.deepEqual(stalled, ["stalled"]);
  assert.deepEqual(active, ["active"]);
});

test("completedRange is unaffected by DST because completedAt is noon-anchored", () => {
  const now = new Date(2026, 3, 8, 10, 0, 0); // Wed 8 Apr
  const noon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);
  const mk = (uid, completedAt) => ({
    uid, title: "t", text: "t", pageTitle: "", isCompleted: true, isBlocked: false,
    completedAt, dueAt: null, editedAt: now.getTime(), metadata: {},
  });
  // 7d window spans the 5 Apr transition. Intended: 2 Apr .. 8 Apr inclusive.
  const tasks = [mk("apr01", noon(2026, 4, 1)), mk("apr02", noon(2026, 4, 2)), mk("apr08", noon(2026, 4, 8))];
  const got = applyFilters(tasks, { Completion: ["completed"], completedRange: "7d" }, "", { now });
  assert.deepEqual(got.map((t) => t.uid), ["apr02", "apr08"]);
});

test("upcomingRange is unaffected by DST because dueAt is noon-anchored", () => {
  const now = new Date(2026, 8, 20, 10, 0, 0); // Sun 20 Sep, window crosses 4 Oct
  const noon = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0);
  const mk = (uid, dueAt) => ({
    uid, title: "t", text: "t", pageTitle: "", isCompleted: false, isBlocked: false,
    completedAt: null, dueAt, dueBucket: "upcoming", editedAt: now.getTime(), metadata: {},
  });
  // 30d window from 20 Sep → through end of 19 Oct.
  const tasks = [mk("oct19", noon(2026, 10, 19)), mk("oct20", noon(2026, 10, 20))];
  const got = applyFilters(tasks, { Due: ["upcoming"], upcomingRange: "30d" }, "", { now });
  assert.deepEqual(got.map((t) => t.uid), ["oct19"]);
});
