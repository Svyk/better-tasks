import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseRuleText,
  normalizeByDayList,
  __setNowProviderForTests,
} from "../src/core/recurrence.js";

// Pin "now" to Thursday 15 January 2026, 09:30 local.
const PINNED_NOW = new Date(2026, 0, 15, 9, 30, 0, 0);
beforeEach(() => __setNowProviderForTests(() => new Date(PINNED_NOW.getTime())));
afterEach(() => __setNowProviderForTests(null));

const MO = { weekStartCode: "MO" };

test("daily patterns", () => {
  assert.deepEqual(parseRuleText("daily", MO), { kind: "DAILY", interval: 1 });
  assert.deepEqual(parseRuleText("every day", MO), { kind: "DAILY", interval: 1 });
  assert.deepEqual(parseRuleText("every other day", MO), { kind: "DAILY", interval: 2 });
  assert.deepEqual(parseRuleText("every third day", MO), { kind: "DAILY", interval: 3 });
  assert.deepEqual(parseRuleText("every 5 days", MO), { kind: "DAILY", interval: 5 });
});

test("weekday and weekend anchors", () => {
  assert.deepEqual(parseRuleText("every weekday", MO), { kind: "WEEKDAY" });
  assert.deepEqual(parseRuleText("weekdays", MO), { kind: "WEEKDAY" });
  assert.deepEqual(parseRuleText("weekends", MO), { kind: "WEEKLY", interval: 1, byDay: ["SA", "SU"] });
  assert.deepEqual(parseRuleText("every 2 business days", MO), { kind: "BUSINESS_DAILY", interval: 2 });
});

test("weekly patterns", () => {
  assert.deepEqual(parseRuleText("weekly", MO), { kind: "WEEKLY", interval: 1, byDay: null });
  assert.deepEqual(parseRuleText("every friday", MO), { kind: "WEEKLY", interval: 1, byDay: ["FR"] });
  assert.deepEqual(parseRuleText("every fri", MO), { kind: "WEEKLY", interval: 1, byDay: ["FR"] });
  assert.deepEqual(parseRuleText("biweekly", MO), { kind: "WEEKLY", interval: 2, byDay: null });
  assert.deepEqual(parseRuleText("fortnightly", MO), { kind: "WEEKLY", interval: 2, byDay: null });
  assert.deepEqual(parseRuleText("every second tuesday", MO), { kind: "WEEKLY", interval: 2, byDay: ["TU"] });
  assert.deepEqual(parseRuleText("every other tuesday", MO), { kind: "WEEKLY", interval: 2, byDay: ["TU"] });
  assert.deepEqual(parseRuleText("every 3 weeks on mon", MO), { kind: "WEEKLY", interval: 3, byDay: ["MO"] });
  assert.deepEqual(parseRuleText("weekly on mon, wed, fri", MO), {
    kind: "WEEKLY", interval: 1, byDay: ["MO", "WE", "FR"],
  });
});

test("weekday shorthand sets and ranges", () => {
  assert.deepEqual(parseRuleText("mwf", MO), { kind: "WEEKLY", interval: 1, byDay: ["MO", "WE", "FR"] });
  assert.deepEqual(parseRuleText("tth", MO), { kind: "WEEKLY", interval: 1, byDay: ["TU", "TH"] });
  assert.deepEqual(parseRuleText("mon-wed", MO), { kind: "WEEKLY", interval: 1, byDay: ["MO", "TU", "WE"] });
  // Range wraps across the week boundary
  assert.deepEqual(parseRuleText("every fri-mon", MO), {
    kind: "WEEKLY", interval: 1, byDay: ["FR", "SA", "SU", "MO"],
  });
});

test("normalizeByDayList respects week start for ranges", () => {
  assert.deepEqual(normalizeByDayList("fri-mon", "MO"), ["FR", "SA", "SU", "MO"]);
  assert.deepEqual(normalizeByDayList("sat, sun", "SU"), ["SA", "SU"]);
});

test("monthly interval keywords", () => {
  assert.deepEqual(parseRuleText("quarterly", MO), { kind: "MONTHLY_DAY", interval: 3 });
  assert.deepEqual(parseRuleText("twice a year", MO), { kind: "MONTHLY_DAY", interval: 6 });
  assert.deepEqual(parseRuleText("semiannually", MO), { kind: "MONTHLY_DAY", interval: 6 });
});

test("monthly patterns", () => {
  // "monthly" anchors to today's day-of-month (pinned to the 15th)
  assert.deepEqual(parseRuleText("monthly", MO), { kind: "MONTHLY_DAY", day: 15 });
  assert.deepEqual(parseRuleText("every month on day 5", MO), { kind: "MONTHLY_DAY", day: 5 });
  assert.deepEqual(parseRuleText("eom", MO), { kind: "MONTHLY_LAST_DAY" });
  assert.deepEqual(parseRuleText("last day of the month", MO), { kind: "MONTHLY_LAST_DAY" });
  assert.deepEqual(parseRuleText("on the 1st and 15th of each month", MO), {
    kind: "MONTHLY_MULTI_DAY", days: [1, 15],
  });
  assert.deepEqual(parseRuleText("15th and last day of every month", MO), {
    kind: "MONTHLY_MIXED_DAY", days: [15], last: true,
  });
  assert.deepEqual(parseRuleText("first monday of each month", MO), {
    kind: "MONTHLY_NTH", nth: "first", dow: "MO",
  });
  assert.deepEqual(parseRuleText("the 1st and 3rd friday of each month", MO), {
    kind: "MONTHLY_MULTI_NTH", nths: ["1st", "3rd"], dow: "FR",
  });
  assert.deepEqual(parseRuleText("penultimate friday of each month", MO), {
    kind: "MONTHLY_NTH_FROM_END", nth: 2, dow: "FR",
  });
  assert.deepEqual(parseRuleText("first weekday of each month", MO), {
    kind: "MONTHLY_NTH_WEEKDAY", nth: "first",
  });
  assert.deepEqual(parseRuleText("every 3 months on the 10th", MO), {
    kind: "MONTHLY_DAY", interval: 3, day: 10,
  });
  assert.deepEqual(parseRuleText("every 2 months on the 15th", MO), {
    kind: "MONTHLY_DAY", interval: 2, day: 15,
  });
  assert.deepEqual(parseRuleText("every 2 months on the first monday", MO), {
    kind: "MONTHLY_NTH", interval: 2, nth: "first", dow: "MO",
  });
});

test("yearly patterns", () => {
  assert.deepEqual(parseRuleText("yearly", MO), { kind: "YEARLY" });
  assert.deepEqual(parseRuleText("annually", MO), { kind: "YEARLY" });
  assert.deepEqual(parseRuleText("every january 15", MO), { kind: "YEARLY", month: 1, day: 15 });
  assert.deepEqual(parseRuleText("march 15th", MO), { kind: "YEARLY", month: 3, day: 15 });
  assert.deepEqual(parseRuleText("first monday of september every year", MO), {
    kind: "YEARLY_NTH", month: 9, nth: "first", dow: "MO",
  });
  assert.deepEqual(parseRuleText("first monday of september", MO), {
    kind: "YEARLY_NTH", month: 9, nth: "first", dow: "MO",
  });
});

test("input normalisation and invalid input", () => {
  assert.deepEqual(parseRuleText("  Every   FRIDAY ", MO), { kind: "WEEKLY", interval: 1, byDay: ["FR"] });
  assert.equal(parseRuleText("", MO), null);
  assert.equal(parseRuleText(null, MO), null);
  assert.equal(parseRuleText("gibberish", MO), null);
  assert.equal(parseRuleText("every blorp", MO), null);
});
