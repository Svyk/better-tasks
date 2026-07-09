import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseTaskLocally,
  validateParsedTask,
  stripSchedulingFromTitle,
} from "../src/core/nlp-capture.js";
import { __setNowProviderForTests } from "../src/core/recurrence.js";

// Pin "now" to Thursday 15 January 2026, 09:30 local.
const PINNED_NOW = new Date(2026, 0, 15, 9, 30, 0, 0);
beforeEach(() => __setNowProviderForTests(() => new Date(PINNED_NOW.getTime())));
afterEach(() => __setNowProviderForTests(null));

// ISO date format keeps expectations independent of roamAlphaAPI DNP titles
const SET = { weekStartCode: "MO", dateFormat: "ISO" };

test("implicit trailing date becomes the due date", () => {
  const r = parseTaskLocally("Buy milk tomorrow", SET);
  assert.equal(r.ok, true);
  assert.equal(r.task.title, "Buy milk");
  assert.equal(r.task.dueDateText, "2026-01-16");
});

test("due:/start:/defer: prefixes", () => {
  const due = parseTaskLocally("Submit report due: friday", SET);
  assert.equal(due.task.title, "Submit report");
  assert.equal(due.task.dueDateText, "2026-01-16");

  const start = parseTaskLocally("Draft slides start: next monday", SET);
  assert.equal(start.task.title, "Draft slides");
  assert.equal(start.task.startDateText, "2026-01-19");

  const defer = parseTaskLocally("Ping Bob defer: in 3 days", SET);
  assert.equal(defer.task.title, "Ping Bob");
  assert.equal(defer.task.deferDateText, "2026-01-18");
});

test("priority, energy, project, and context markers", () => {
  const r = parseTaskLocally("Fix bug !high ~low @home p:Website", SET);
  assert.equal(r.ok, true);
  assert.equal(r.task.title, "Fix bug");
  assert.equal(r.task.priority, "high");
  assert.equal(r.task.energy, "low");
  assert.equal(r.task.context, "home");
  assert.equal(r.task.project, "Website");
});

test("quoted project names keep their spaces", () => {
  const r = parseTaskLocally('Plan retro p:"Big Launch"', SET);
  assert.equal(r.task.project, "Big Launch");
  assert.equal(r.task.title, "Plan retro");
});

test("repeat rules are extracted and removed from the title", () => {
  const r = parseTaskLocally("Water plants every friday", SET);
  assert.equal(r.task.title, "Water plants");
  assert.equal(r.task.repeatRule, "every friday");
});

test("repeat rule combines with an explicit due date", () => {
  const r = parseTaskLocally("Pay rent monthly due: end of month", SET);
  assert.equal(r.task.title, "Pay rent");
  assert.equal(r.task.repeatRule, "monthly");
  assert.equal(r.task.dueDateText, "2026-01-31");
});

test("plain text yields a title-only task", () => {
  const r = parseTaskLocally("Just a plain task", SET);
  assert.equal(r.ok, true);
  assert.deepEqual(r.task, { title: "Just a plain task" });
});

test("empty or non-string input is rejected", () => {
  assert.equal(parseTaskLocally("", SET).ok, false);
  assert.equal(parseTaskLocally(null, SET).ok, false);
  assert.equal(parseTaskLocally(42, SET).ok, false);
});

test("validateParsedTask enforces the schema", () => {
  assert.equal(validateParsedTask(null).ok, false);
  assert.equal(validateParsedTask({}).ok, false);
  assert.equal(validateParsedTask({ title: "   " }).ok, false);

  const ok = validateParsedTask({ title: "T", priority: "high", energy: "bogus" });
  assert.equal(ok.ok, true);
  assert.equal(ok.task.priority, "high");
  assert.equal("energy" in ok.task, false); // invalid rating dropped

  const cleared = validateParsedTask({ title: "T", priority: null });
  assert.equal(cleared.task.priority, null); // explicit null preserved (clear)
});

test("stripSchedulingFromTitle removes trailing schedule hints", () => {
  assert.equal(
    stripSchedulingFromTitle("Water plants every friday", { repeatRule: "every friday" }),
    "Water plants"
  );
  assert.equal(
    stripSchedulingFromTitle("Submit report by tomorrow", { dueDateText: "2026-01-16" }),
    "Submit report"
  );
  assert.equal(
    stripSchedulingFromTitle("Review notes on [[January 16th, 2026]]", { dueDateText: "2026-01-16" }),
    "Review notes"
  );
  // Without parsed scheduling info the title is untouched
  assert.equal(stripSchedulingFromTitle("Water plants every friday", null), "Water plants every friday");
});
