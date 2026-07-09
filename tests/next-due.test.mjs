import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { computeNextDue, __setNowProviderForTests } from "../src/core/recurrence.js";

// Pin "now" to Thursday 15 January 2026, 09:30 local.
const PINNED_NOW = new Date(2026, 0, 15, 9, 30, 0, 0);
beforeEach(() => __setNowProviderForTests(() => new Date(PINNED_NOW.getTime())));
afterEach(() => __setNowProviderForTests(null));

const SET = { advanceFrom: "due", weekStartCode: "MO" };
const d = (y, m, day) => new Date(y, m - 1, day, 12, 0, 0, 0);

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("daily advances one day from the due date", () => {
  const next = computeNextDue({ repeat: "daily", due: d(2026, 6, 10) }, SET);
  assert.equal(ymd(next), "2026-06-11");
  assert.equal(next.getHours(), 12); // noon anchoring
});

test("daily catches up past-due tasks to today", () => {
  const next = computeNextDue({ repeat: "daily", due: d(2026, 1, 10) }, SET);
  assert.equal(ymd(next), "2026-01-15");
});

test("advance-from-completion bases on today, not the due date", () => {
  const set = { ...SET, advanceFrom: "completion" };
  const next = computeNextDue({ repeat: "daily", due: d(2025, 11, 1) }, set);
  assert.equal(ymd(next), "2026-01-16");
});

test("weekly with byDay picks the next listed weekday", () => {
  // Thu 11 June 2026, repeat Mon+Thu -> Mon 15 June
  const next = computeNextDue({ repeat: "weekly on mon, thu", due: d(2026, 6, 11) }, SET);
  assert.equal(ymd(next), "2026-06-15");
});

test("fortnightly without byDay adds 14 days", () => {
  const next = computeNextDue({ repeat: "fortnightly", due: d(2026, 6, 11) }, SET);
  assert.equal(ymd(next), "2026-06-25");
});

test("weekday rule skips weekends", () => {
  // Fri 12 June 2026 -> Mon 15 June
  const next = computeNextDue({ repeat: "every weekday", due: d(2026, 6, 12) }, SET);
  assert.equal(ymd(next), "2026-06-15");
});

test("end-of-month clamping: day 31 in a 28-day month", () => {
  const next = computeNextDue({ repeat: "every month on day 31", due: d(2026, 1, 31) }, SET);
  assert.equal(ymd(next), "2026-02-28");
});

test("end-of-month clamping respects leap years", () => {
  const next = computeNextDue({ repeat: "every month on day 31", due: d(2028, 1, 31) }, SET);
  assert.equal(ymd(next), "2028-02-29");
});

test("last day of month from mid-month and from EOM", () => {
  assert.equal(ymd(computeNextDue({ repeat: "eom", due: d(2026, 2, 10) }, SET)), "2026-02-28");
  assert.equal(ymd(computeNextDue({ repeat: "eom", due: d(2026, 2, 28) }, SET)), "2026-03-31");
});

test("first monday of each month", () => {
  const next = computeNextDue({ repeat: "first monday of each month", due: d(2026, 6, 10) }, SET);
  assert.equal(ymd(next), "2026-07-06");
});

test("every 2 months on the first monday advances two months", () => {
  // From Mon 6 Jul 2026, +2 months -> first Monday of September = Mon 7 Sep 2026
  const next = computeNextDue({ repeat: "every 2 months on the first monday", due: d(2026, 7, 6) }, SET);
  assert.equal(ymd(next), "2026-09-07");
});

test("semimonthly multi-day (1st and 15th)", () => {
  const next = computeNextDue({ repeat: "on the 1st and 15th of each month", due: d(2026, 6, 2) }, SET);
  assert.equal(ymd(next), "2026-06-15");
  // Wrapping into the next month must still include the 1st.
  const wrap = computeNextDue({ repeat: "on the 1st and 15th of each month", due: d(2026, 6, 20) }, SET);
  assert.equal(ymd(wrap), "2026-07-01");
});

test("yearly rolls to next year when this year's date has passed", () => {
  const next = computeNextDue({ repeat: "every january 15", due: d(2026, 6, 1) }, SET);
  assert.equal(ymd(next), "2027-01-15");
});

test("exception dates are skipped", () => {
  const meta = { repeat: "daily", due: d(2026, 6, 10), exceptions: ["2026-06-11"] };
  const next = computeNextDue(meta, SET);
  assert.equal(ymd(next), "2026-06-12");
});

test("unparseable rule returns null and fires the failure hook", () => {
  let failed = null;
  const next = computeNextDue({ repeat: "blorp", due: d(2026, 6, 10), uid: "abc" }, SET, 0, null, {
    onRuleFailed: (m) => { failed = m.uid; },
  });
  assert.equal(next, null);
  assert.equal(failed, "abc");
});

test("DST transitions keep the noon anchor (AU: DST ends 2026-04-05, starts 2026-10-04)", () => {
  const across = computeNextDue({ repeat: "daily", due: d(2026, 4, 4) }, SET);
  assert.equal(ymd(across), "2026-04-05");
  assert.equal(across.getHours(), 12);

  const intoDst = computeNextDue({ repeat: "daily", due: d(2026, 10, 3) }, SET);
  assert.equal(ymd(intoDst), "2026-10-04");
  assert.equal(intoDst.getHours(), 12);
});
