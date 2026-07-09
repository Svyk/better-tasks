import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseRelativeDateText,
  parseRoamDate,
  __setNowProviderForTests,
} from "../src/core/recurrence.js";

// Pin "now" to Thursday 15 January 2026, 09:30 local.
const PINNED_NOW = new Date(2026, 0, 15, 9, 30, 0, 0);
beforeEach(() => __setNowProviderForTests(() => new Date(PINNED_NOW.getTime())));
afterEach(() => __setNowProviderForTests(null));

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("simple keywords", () => {
  assert.equal(ymd(parseRelativeDateText("today")), "2026-01-15");
  assert.equal(ymd(parseRelativeDateText("tomorrow")), "2026-01-16");
  assert.equal(ymd(parseRelativeDateText("tmr")), "2026-01-16");
  assert.equal(ymd(parseRelativeDateText("tonight")), "2026-01-15");
});

test("compact offsets (+3d, +2w, +1m)", () => {
  assert.equal(ymd(parseRelativeDateText("+3d")), "2026-01-18");
  assert.equal(ymd(parseRelativeDateText("+2w")), "2026-01-29");
  assert.equal(ymd(parseRelativeDateText("+1m")), "2026-02-15");
});

test("+1m clamps at end of shorter months", () => {
  __setNowProviderForTests(() => new Date(2026, 0, 31, 9, 0, 0, 0)); // Sat 31 Jan 2026
  assert.equal(ymd(parseRelativeDateText("+1m")), "2026-02-28");
});

test("in N / N from now", () => {
  assert.equal(ymd(parseRelativeDateText("in 2 weeks")), "2026-01-29");
  assert.equal(ymd(parseRelativeDateText("3 days from now")), "2026-01-18");
  assert.equal(ymd(parseRelativeDateText("in 1 month")), "2026-02-15");
});

test("week-relative phrases (week starts Monday)", () => {
  assert.equal(ymd(parseRelativeDateText("next week", "MO")), "2026-01-19");
  assert.equal(ymd(parseRelativeDateText("end of week", "MO")), "2026-01-18");
  assert.equal(ymd(parseRelativeDateText("early next week", "MO")), "2026-01-19");
  assert.equal(ymd(parseRelativeDateText("mid next week", "MO")), "2026-01-22");
  assert.equal(ymd(parseRelativeDateText("this weekend", "MO")), "2026-01-17");
  assert.equal(ymd(parseRelativeDateText("next weekend", "MO")), "2026-01-24");
});

test("week start setting shifts week-relative results", () => {
  // With a Sunday week start, this week began Sun 11 Jan, so end of week is Sat 17 Jan
  assert.equal(ymd(parseRelativeDateText("end of week", "SU")), "2026-01-17");
});

test("weekday names resolve to the next occurrence", () => {
  assert.equal(ymd(parseRelativeDateText("friday")), "2026-01-16");
  assert.equal(ymd(parseRelativeDateText("next friday")), "2026-01-16");
  assert.equal(ymd(parseRelativeDateText("this monday")), "2026-01-19");
});

test("month phrases", () => {
  assert.equal(ymd(parseRelativeDateText("next month")), "2026-02-01");
  assert.equal(ymd(parseRelativeDateText("end of month")), "2026-01-31");
  assert.equal(ymd(parseRelativeDateText("end of year")), "2026-12-31");
  assert.equal(ymd(parseRelativeDateText("early march")), "2026-03-05");
  assert.equal(ymd(parseRelativeDateText("mid march")), "2026-03-15");
  assert.equal(ymd(parseRelativeDateText("late december")), "2026-12-25");
});

test("unknown text returns null", () => {
  assert.equal(parseRelativeDateText("not a date"), null);
  assert.equal(parseRelativeDateText(""), null);
  assert.equal(parseRelativeDateText(null), null);
});

test("parseRoamDate handles ISO and DNP titles (noon anchored)", () => {
  assert.equal(ymd(parseRoamDate("2026-03-05")), "2026-03-05");
  assert.equal(ymd(parseRoamDate("[[2026-03-05]]")), "2026-03-05");
  assert.equal(parseRoamDate("2026-03-05").getHours(), 12);
  // In Node there is no roamAlphaAPI, so this exercises the fallback parser
  assert.equal(ymd(parseRoamDate("[[March 5th, 2026]]")), "2026-03-05");
  assert.equal(ymd(parseRoamDate("November 14th, 2025")), "2025-11-14");
  assert.equal(parseRoamDate("definitely not a date"), null);
  assert.equal(parseRoamDate(""), null);
});
