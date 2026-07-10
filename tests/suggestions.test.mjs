import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUGGESTION_DEFAULTS,
  SUGGESTION_RULE_IDS,
  toISODateLocal,
  ruleSnoozeSomeday,
  ruleDayOfWeekPattern,
  ruleLoadBalance,
  ruleStalledSomeday,
  ruleRecurringAdherence,
  computeSuggestions,
  filterDismissed,
  suggestionSubject,
  pruneDismissals,
} from "../src/core/suggestions.js";

// Pin "now" to Thursday 9 July 2026, 10:30 local.
const NOW = new Date(2026, 6, 9, 10, 30, 0, 0);
const START_OF_TODAY = new Date(2026, 6, 9, 0, 0, 0, 0);

// Noon-anchored, as parseRoamDate produces.
const d = (y, m, day) => new Date(y, m - 1, day, 12, 0, 0, 0);

const T = SUGGESTION_DEFAULTS;
const OPTS = { ...T, now: NOW };

const task = (over = {}) => ({
  uid: "u1",
  title: "Task",
  isCompleted: false,
  isRecurring: false,
  isBlocked: false,
  dueAt: null,
  deferUntil: null,
  startAt: null,
  editedAt: NOW.getTime(),
  metadata: {},
  ...over,
});

// A series whose completions land mostly on Tuesday, open member due Friday.
const series = (over = {}) => ({
  seriesId: "series1",
  title: "Water the plants",
  openMember: { uid: "open1", dueAt: d(2026, 7, 10) }, // Friday
  completions: [
    { completedAt: d(2026, 6, 2), dueAt: null }, // Tue
    { completedAt: d(2026, 6, 9), dueAt: null }, // Tue
    { completedAt: d(2026, 6, 16), dueAt: null }, // Tue
    { completedAt: d(2026, 6, 23), dueAt: null }, // Tue
    { completedAt: d(2026, 6, 25), dueAt: null }, // Thu
  ],
  stats: { onTimeRate: 100, totalCompleted: 5, totalWithDue: 5 },
  ...over,
});

// ========================= snooze-someday =========================

test("snooze-someday triggers at exactly the threshold", () => {
  const s = ruleSnoozeSomeday(task(), T.snoozeThreshold, T);
  assert.ok(s);
  assert.equal(s.id, "snooze-someday:u1");
  assert.equal(s.ruleId, "snooze-someday");
  assert.equal(s.params.count, 5);
  assert.deepEqual(s.action, { type: "set-gtd", payload: { gtd: "someday" } });
});

test("snooze-someday does not trigger below the threshold", () => {
  assert.equal(ruleSnoozeSomeday(task(), T.snoozeThreshold - 1, T), null);
});

test("snooze-someday skips recurring, completed, blocked, and someday tasks", () => {
  assert.equal(ruleSnoozeSomeday(task({ isRecurring: true }), 9, T), null);
  assert.equal(ruleSnoozeSomeday(task({ isCompleted: true }), 9, T), null);
  assert.equal(ruleSnoozeSomeday(task({ isBlocked: true }), 9, T), null);
  assert.equal(ruleSnoozeSomeday(task({ metadata: { gtd: "someday" } }), 9, T), null);
  assert.equal(ruleSnoozeSomeday(task({ metadata: { gtd: "Someday" } }), 9, T), null);
});

test("snooze-someday ignores unknown counts", () => {
  assert.equal(ruleSnoozeSomeday(task(), undefined, T), null);
  assert.equal(ruleSnoozeSomeday(task(), null, T), null);
});

test("snooze-someday score grows with evidence but stays in its band", () => {
  assert.equal(ruleSnoozeSomeday(task(), 5, T).score, 90);
  assert.equal(ruleSnoozeSomeday(task(), 50, T).score, 99);
});

// ========================= dow-pattern =========================

test("dow-pattern triggers when the modal weekday differs from the due weekday", () => {
  const s = ruleDayOfWeekPattern(series(), OPTS);
  assert.ok(s);
  assert.equal(s.id, "dow-pattern:series1:2"); // target weekday in the id
  assert.equal(s.taskUid, "open1");
  assert.deepEqual(
    { weekday: s.params.weekday, count: s.params.count, percent: s.params.percent },
    { weekday: 2, count: 5, percent: 80 }
  );
  // Tuesday of the week containing Friday 10 July 2026 is 7 July — in the past
  // relative to NOW (Thu 9 July), so it rolls forward one week to 14 July.
  assert.equal(s.action.payload.dueISO, "2026-07-14");
});

test("dow-pattern target stays in the due week when not in the past", () => {
  // Open member due Monday 13 July; Tuesday 14 July is in the future already.
  const s = ruleDayOfWeekPattern(
    series({ openMember: { uid: "open1", dueAt: d(2026, 7, 13) } }),
    OPTS
  );
  assert.equal(s.action.payload.dueISO, "2026-07-14");
});

test("dow-pattern does not trigger when due already on the modal weekday", () => {
  const s = ruleDayOfWeekPattern(
    series({ openMember: { uid: "open1", dueAt: d(2026, 7, 14) } }), // Tuesday
    OPTS
  );
  assert.equal(s, null);
});

test("dow-pattern requires the minimum completion sample", () => {
  const few = series();
  few.completions = few.completions.slice(0, 4);
  assert.equal(ruleDayOfWeekPattern(few, OPTS), null);
});

test("dow-pattern requires the concentration threshold", () => {
  const spread = series({
    completions: [
      { completedAt: d(2026, 6, 2) }, // Tue
      { completedAt: d(2026, 6, 9) }, // Tue
      { completedAt: d(2026, 6, 16) }, // Tue
      { completedAt: d(2026, 6, 4) }, // Thu
      { completedAt: d(2026, 6, 12) }, // Fri
      { completedAt: d(2026, 6, 13) }, // Sat
    ],
  });
  // 3 of 6 = 50% < 60%
  assert.equal(ruleDayOfWeekPattern(spread, OPTS), null);
});

test("dow-pattern requires an open member with a due date", () => {
  assert.equal(ruleDayOfWeekPattern(series({ openMember: null }), OPTS), null);
  assert.equal(
    ruleDayOfWeekPattern(series({ openMember: { uid: "open1", dueAt: null } }), OPTS),
    null
  );
});

// ========================= load-balance =========================

const loadedWeek = () => [
  // Five one-offs due Monday 13 July (peak day), staggered priorities.
  task({ uid: "a", dueAt: d(2026, 7, 13), metadata: { priority: "high" } }),
  task({ uid: "b", dueAt: d(2026, 7, 13), metadata: { priority: "medium" } }),
  task({ uid: "c", dueAt: d(2026, 7, 13), metadata: { priority: "low" } }),
  task({ uid: "d", dueAt: d(2026, 7, 13), metadata: { priority: "low" } }),
  task({ uid: "e", dueAt: d(2026, 7, 13) }),
  // One due Tuesday so the window total reaches 6; Friday 10th etc. stay empty.
  task({ uid: "f", dueAt: d(2026, 7, 14) }),
];

test("load-balance suggests moving the safest task from the peak day to an empty day", () => {
  const out = ruleLoadBalance(loadedWeek(), OPTS);
  assert.equal(out.length, 1);
  const s = out[0];
  // Lowest priority wins, uid tiebreak: c and d are both "low", c sorts first.
  assert.equal(s.taskUid, "c");
  assert.equal(s.id, "load-balance:c");
  // Empty day nearest the peak (Mon 13 July): Sun 12 July at distance 1.
  assert.equal(s.action.payload.dueISO, "2026-07-12");
  assert.equal(s.params.fromCount, 5);
  assert.equal(s.params.fromISO, "2026-07-13");
});

test("load-balance prefers the later empty day on a distance tie", () => {
  // Peak Mon 13 July (4 tasks); Sun 12 and Tue 14 occupied, so the nearest
  // empty days are Sat 11 and Wed 15, both at distance 2 — Wed must win.
  const tasks = [
    task({ uid: "a", dueAt: d(2026, 7, 13) }),
    task({ uid: "b", dueAt: d(2026, 7, 13) }),
    task({ uid: "c", dueAt: d(2026, 7, 13) }),
    task({ uid: "d", dueAt: d(2026, 7, 13) }),
    task({ uid: "e", dueAt: d(2026, 7, 12) }),
    task({ uid: "f", dueAt: d(2026, 7, 14) }),
    task({ uid: "g", dueAt: d(2026, 7, 10) }),
    task({ uid: "h", dueAt: d(2026, 7, 16) }),
  ];
  const out = ruleLoadBalance(tasks, OPTS);
  assert.equal(out.length, 1);
  assert.equal(out[0].action.payload.dueISO, "2026-07-15");
});

test("load-balance is deterministic", () => {
  const first = ruleLoadBalance(loadedWeek(), OPTS);
  const second = ruleLoadBalance(loadedWeek(), OPTS);
  assert.deepEqual(first, second);
});

test("load-balance does not trigger below the window total", () => {
  const tasks = loadedWeek().slice(0, 5); // total 5 < 6
  assert.deepEqual(ruleLoadBalance(tasks, OPTS), []);
});

test("load-balance does not trigger without an empty day", () => {
  const tasks = [];
  for (let day = 10; day <= 16; day += 1) {
    tasks.push(task({ uid: `t${day}a`, dueAt: d(2026, 7, day) }));
  }
  // 7 days each with one task — no zero day (and no peak >= 4 either).
  assert.deepEqual(ruleLoadBalance(tasks, OPTS), []);
});

test("load-balance does not trigger when the peak is too small", () => {
  const tasks = [
    task({ uid: "a", dueAt: d(2026, 7, 13) }),
    task({ uid: "b", dueAt: d(2026, 7, 13) }),
    task({ uid: "c", dueAt: d(2026, 7, 13) }),
    task({ uid: "d", dueAt: d(2026, 7, 14) }),
    task({ uid: "e", dueAt: d(2026, 7, 14) }),
    task({ uid: "f", dueAt: d(2026, 7, 15) }),
  ];
  // total 6, but peak day has 3 < loadMinPeak 4
  assert.deepEqual(ruleLoadBalance(tasks, OPTS), []);
});

test("load-balance counts recurring/blocked load but never moves it", () => {
  const tasks = [
    task({ uid: "a", dueAt: d(2026, 7, 13), isRecurring: true }),
    task({ uid: "b", dueAt: d(2026, 7, 13), isRecurring: true }),
    task({ uid: "c", dueAt: d(2026, 7, 13), isBlocked: true }),
    task({ uid: "d", dueAt: d(2026, 7, 13), isBlocked: true }),
    task({ uid: "e", dueAt: d(2026, 7, 14) }),
    task({ uid: "f", dueAt: d(2026, 7, 14) }),
  ];
  // Peak day has 4 tasks but none are movable.
  assert.deepEqual(ruleLoadBalance(tasks, OPTS), []);
});

test("load-balance skips candidates deferred past the target day", () => {
  const tasks = loadedWeek().map((t) =>
    t.uid === "c" || t.uid === "d"
      ? { ...t, deferUntil: d(2026, 7, 13) } // after the Sun 12 July target
      : t
  );
  const out = ruleLoadBalance(tasks, OPTS);
  assert.equal(out.length, 1);
  assert.equal(out[0].taskUid, "e"); // unset priority beats medium/high
});

// ========================= stalled-someday =========================

test("stalled-someday boundary matches the dashboard Stalled filter", () => {
  // Threshold: start of today minus 14 days = 25 June 2026 00:00.
  const threshold = new Date(2026, 5, 25, 0, 0, 0, 0).getTime();
  assert.equal(ruleStalledSomeday(task({ editedAt: threshold }), OPTS), null); // exactly at = active
  const s = ruleStalledSomeday(task({ editedAt: threshold - 1 }), OPTS);
  assert.ok(s);
  assert.equal(s.id, "stalled-someday:u1");
  assert.equal(s.params.days, 14);
});

test("stalled-someday treats a missing edit time as stalled", () => {
  const s = ruleStalledSomeday(task({ editedAt: null }), OPTS);
  assert.ok(s);
  assert.equal(s.params.days, T.stalledDays);
});

test("stalled-someday respects the due-date guard", () => {
  const old = new Date(2026, 5, 1, 12, 0, 0, 0).getTime();
  // Due 61 days out — far future, still triggers.
  assert.ok(ruleStalledSomeday(task({ editedAt: old, dueAt: d(2026, 9, 8) }), OPTS));
  // Due 30 days out — scheduled, does not trigger.
  assert.equal(ruleStalledSomeday(task({ editedAt: old, dueAt: d(2026, 8, 8) }), OPTS), null);
  // No due — triggers.
  assert.ok(ruleStalledSomeday(task({ editedAt: old }), OPTS));
});

test("stalled-someday skips recurring, blocked, completed, and someday tasks", () => {
  const over = { editedAt: null };
  assert.equal(ruleStalledSomeday(task({ ...over, isRecurring: true }), OPTS), null);
  assert.equal(ruleStalledSomeday(task({ ...over, isBlocked: true }), OPTS), null);
  assert.equal(ruleStalledSomeday(task({ ...over, isCompleted: true }), OPTS), null);
  assert.equal(ruleStalledSomeday(task({ ...over, metadata: { gtd: "someday" } }), OPTS), null);
});

// ========================= recurring-adherence =========================

test("recurring-adherence triggers at the rate boundary", () => {
  // totalCompleted deliberately differs from totalWithDue: the displayed
  // count must be the population the rate was computed over (with-due).
  const bad = series({ stats: { onTimeRate: 50, totalCompleted: 8, totalWithDue: 6 } });
  const s = ruleRecurringAdherence(bad, T);
  assert.ok(s);
  assert.equal(s.id, "recurring-adherence:series1");
  assert.deepEqual(s.params, { rate: 50, count: 6 });
  assert.equal(s.action.type, "edit-repeat");
  const okSeries = series({ stats: { onTimeRate: 51, totalCompleted: 6, totalWithDue: 6 } });
  assert.equal(ruleRecurringAdherence(okSeries, T), null);
});

test("recurring-adherence requires the minimum sample", () => {
  const small = series({ stats: { onTimeRate: 0, totalCompleted: 4, totalWithDue: 4 } });
  assert.equal(ruleRecurringAdherence(small, T), null);
});

test("recurring-adherence requires an open member", () => {
  const done = series({
    openMember: null,
    stats: { onTimeRate: 0, totalCompleted: 6, totalWithDue: 6 },
  });
  assert.equal(ruleRecurringAdherence(done, T), null);
});

// ========================= orchestrator =========================

test("computeSuggestions yields nothing from a disabled rule", () => {
  const input = { tasks: [task()], snoozeCounts: new Map([["u1", 9]]), series: [] };
  const on = computeSuggestions(input, { now: NOW });
  assert.equal(on.length, 1);
  const off = computeSuggestions(input, {
    now: NOW,
    enabledRules: { "snooze-someday": false },
  });
  assert.equal(off.length, 0);
});

test("computeSuggestions is silent on snooze counts when the map is null", () => {
  const input = { tasks: [task()], snoozeCounts: null, series: [] };
  assert.deepEqual(
    computeSuggestions(input, { now: NOW }).filter((s) => s.ruleId === "snooze-someday"),
    []
  );
});

test("computeSuggestions dedupes: snooze beats stalled for the same task", () => {
  const both = task({ editedAt: null }); // stalled AND heavily snoozed
  const input = { tasks: [both], snoozeCounts: new Map([["u1", 7]]), series: [] };
  const out = computeSuggestions(input, { now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].ruleId, "snooze-someday");
});

test("computeSuggestions orders by score, then id", () => {
  const stalled = task({ uid: "s1", editedAt: null });
  const snoozed = task({ uid: "z1" });
  const input = {
    tasks: [stalled, snoozed],
    snoozeCounts: new Map([["z1", 5]]),
    series: [series()],
  };
  const out = computeSuggestions(input, { now: NOW });
  assert.deepEqual(
    out.map((s) => s.ruleId),
    ["snooze-someday", "dow-pattern", "stalled-someday"]
  );
});

test("computeSuggestions enforces per-rule and total caps", () => {
  const tasks = [];
  for (let i = 0; i < 20; i += 1) {
    tasks.push(task({ uid: `t${String(i).padStart(2, "0")}`, editedAt: null }));
  }
  const out = computeSuggestions({ tasks, snoozeCounts: null, series: [] }, { now: NOW });
  assert.equal(out.length, T.maxPerRule); // 5 stalled suggestions, not 20
  const capped = computeSuggestions(
    { tasks, snoozeCounts: null, series: [] },
    { now: NOW, thresholds: { maxPerRule: 20, maxTotal: 8 } }
  );
  assert.equal(capped.length, 8);
});

test("computeSuggestions ids are stable across recomputes with equal input", () => {
  const input = {
    tasks: [task({ editedAt: null })],
    snoozeCounts: new Map([["u1", 6]]),
    series: [series()],
  };
  const a = computeSuggestions(input, { now: NOW }).map((s) => s.id);
  const b = computeSuggestions(input, { now: NOW }).map((s) => s.id);
  assert.deepEqual(a, b);
});

// ========================= filterDismissed =========================

const sugg = (id) => ({ id, ruleId: id.split(":")[0], score: 50 });

test("filterDismissed suppresses entries inside the cooldown", () => {
  const entries = { "snooze-someday:u1": { ts: NOW.getTime() - 1000, kind: "dismissed" } };
  const out = filterDismissed([sugg("snooze-someday:u1"), sugg("stalled-someday:u2")], entries, {
    now: NOW,
    cooldownDays: T.cooldownDays,
  });
  assert.deepEqual(out.map((s) => s.id), ["stalled-someday:u2"]);
});

test("filterDismissed lets a suggestion return at exactly the cooldown boundary", () => {
  const boundary = new Date(2026, 5, 9, 10, 30, 0, 0).getTime(); // 30 calendar days before NOW
  const entries = { "snooze-someday:u1": { ts: boundary, kind: "dismissed" } };
  const out = filterDismissed([sugg("snooze-someday:u1")], entries, {
    now: NOW,
    cooldownDays: 30,
  });
  assert.equal(out.length, 1);
  const inside = filterDismissed([sugg("snooze-someday:u1")], {
    "snooze-someday:u1": { ts: boundary + 1, kind: "dismissed" },
  }, { now: NOW, cooldownDays: 30 });
  assert.equal(inside.length, 0);
});

test("filterDismissed treats accepted entries like dismissed ones", () => {
  const entries = { "recurring-adherence:series1": { ts: NOW.getTime(), kind: "accepted" } };
  const out = filterDismissed([sugg("recurring-adherence:series1")], entries, { now: NOW });
  assert.equal(out.length, 0);
});

test("filterDismissed ignores unknown and malformed entries", () => {
  const entries = { "stale:gone": { ts: NOW.getTime() }, "snooze-someday:u1": { kind: "dismissed" } };
  const out = filterDismissed([sugg("snooze-someday:u1")], entries, { now: NOW });
  assert.equal(out.length, 1); // malformed entry (no ts) does not suppress
});

// ========================= pruneDismissals / suggestionSubject =========================

test("suggestionSubject parses every rule id shape", () => {
  assert.equal(suggestionSubject("snooze-someday:abc_-123"), "abc_-123");
  assert.equal(suggestionSubject("dow-pattern:seriesX:2"), "seriesX");
  assert.equal(suggestionSubject("load-balance:u9"), "u9");
  assert.equal(suggestionSubject("stalled-someday:u9"), "u9");
  assert.equal(suggestionSubject("recurring-adherence:rtP1"), "rtP1");
  assert.equal(suggestionSubject("garbage"), null);
  assert.equal(suggestionSubject(null), null);
});

test("pruneDismissals drops aged entries", () => {
  const old = new Date(2026, 5, 8, 0, 0, 0, 0).getTime(); // > 30 days before NOW
  const fresh = NOW.getTime() - 1000;
  const { entries, changed } = pruneDismissals(
    { "snooze-someday:a": { ts: old, kind: "dismissed" }, "snooze-someday:b": { ts: fresh, kind: "dismissed" } },
    { now: NOW, existingSubjects: new Set(["a", "b"]) }
  );
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(entries), ["snooze-someday:b"]);
});

test("pruneDismissals drops entries whose subject no longer exists", () => {
  const fresh = NOW.getTime() - 1000;
  const { entries, changed } = pruneDismissals(
    { "snooze-someday:alive": { ts: fresh }, "stalled-someday:dead": { ts: fresh } },
    { now: NOW, existingSubjects: new Set(["alive"]) }
  );
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(entries), ["snooze-someday:alive"]);
});

test("pruneDismissals evicts the oldest entries beyond the cap", () => {
  const store = {};
  const subjects = new Set();
  for (let i = 0; i < 10; i += 1) {
    store[`snooze-someday:t${i}`] = { ts: NOW.getTime() - i * 1000, kind: "dismissed" };
    subjects.add(`t${i}`);
  }
  const { entries, changed } = pruneDismissals(store, {
    now: NOW,
    existingSubjects: subjects,
    maxEntries: 3,
  });
  assert.equal(changed, true);
  // Newest three survive (smallest age offsets).
  assert.deepEqual(Object.keys(entries).sort(), [
    "snooze-someday:t0",
    "snooze-someday:t1",
    "snooze-someday:t2",
  ]);
});

test("pruneDismissals is idempotent on a clean store", () => {
  const fresh = NOW.getTime() - 1000;
  const store = { "snooze-someday:a": { ts: fresh, kind: "dismissed" } };
  const first = pruneDismissals(store, { now: NOW, existingSubjects: new Set(["a"]) });
  assert.equal(first.changed, false);
  assert.deepEqual(first.entries, store);
  const second = pruneDismissals(first.entries, { now: NOW, existingSubjects: new Set(["a"]) });
  assert.equal(second.changed, false);
  assert.deepEqual(second.entries, store);
});

// ========================= misc =========================

test("toISODateLocal uses local calendar parts", () => {
  assert.equal(toISODateLocal(new Date(2026, 0, 5, 0, 30, 0, 0)), "2026-01-05");
  assert.equal(toISODateLocal(d(2026, 12, 31)), "2026-12-31");
});

test("SUGGESTION_RULE_IDS covers exactly the five rules", () => {
  assert.deepEqual(SUGGESTION_RULE_IDS, [
    "snooze-someday",
    "dow-pattern",
    "load-balance",
    "stalled-someday",
    "recurring-adherence",
  ]);
});
