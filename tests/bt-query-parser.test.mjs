import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBtQuery,
  isBtQueryBlock,
  KNOWN_KEYS,
} from "../src/core/bt-query-parser.js";

// ========================= detection =========================

test("isBtQueryBlock detects invocations", () => {
  assert.equal(isBtQueryBlock("{{bt-query}}"), true);
  assert.equal(isBtQueryBlock('{{bt-query: status="TODO"}}'), true);
  assert.equal(isBtQueryBlock("prefix {{ bt-query : due=today }} suffix"), true);
  assert.equal(isBtQueryBlock("{{BT-QUERY}}"), true, "case-insensitive");
  assert.equal(isBtQueryBlock("{{query: {and: [[TODO]]}}}"), false);
  assert.equal(isBtQueryBlock("bt-query without braces"), false);
  assert.equal(isBtQueryBlock(null), false);
});

// ========================= basics =========================

test("bare invocation parses with empty filters and no errors", () => {
  const r = parseBtQuery("{{bt-query}}");
  assert.equal(r.isBtQuery, true);
  assert.deepEqual(r.filters, {});
  assert.equal(r.limit, null);
  assert.equal(r.sort, null);
  assert.deepEqual(r.errors, []);
});

test("non-bt-query text returns isBtQuery false", () => {
  const r = parseBtQuery("just a task");
  assert.equal(r.isBtQuery, false);
});

test("parses quoted and bare values", () => {
  const r = parseBtQuery('{{bt-query: status="TODO" due=this-week limit=5}}');
  assert.deepEqual(r.errors, []);
  assert.equal(r.filters.status, "TODO");
  assert.equal(r.filters.due, "this-week");
  assert.equal(r.limit, 5);
});

test("single quotes work", () => {
  const r = parseBtQuery("{{bt-query: project='Website Refresh'}}");
  assert.deepEqual(r.errors, []);
  assert.equal(r.filters.project, "Website Refresh");
});

test("keys are case-insensitive", () => {
  const r = parseBtQuery('{{bt-query: STATUS="done" Due="overdue"}}');
  assert.deepEqual(r.errors, []);
  assert.equal(r.filters.status, "DONE");
  assert.equal(r.filters.due, "overdue");
});

// ========================= project values =========================

test("project strips [[...]] and # wrappers", () => {
  assert.equal(parseBtQuery('{{bt-query: project="[[X]]"}}').filters.project, "X");
  assert.equal(parseBtQuery('{{bt-query: project="#X"}}').filters.project, "X");
  assert.equal(parseBtQuery('{{bt-query: project="X"}}').filters.project, "X");
});

test("bare [[Page Title]] with spaces reads to the matching brackets", () => {
  const r = parseBtQuery("{{bt-query: project=[[Website Refresh]] status=TODO}}");
  assert.deepEqual(r.errors, []);
  assert.equal(r.filters.project, "Website Refresh");
  assert.equal(r.filters.status, "TODO");
});

// ========================= validation =========================

test("status accepts TODO/DONE/all and rejects others", () => {
  assert.equal(parseBtQuery('{{bt-query: status="all"}}').filters.status, "all");
  const bad = parseBtQuery('{{bt-query: status="MAYBE"}}');
  assert.equal(bad.filters.status, undefined);
  assert.deepEqual(bad.errors, [{ code: "badValue", key: "status", value: "MAYBE" }]);
});

test("due accepts named buckets, ISO dates and ranges", () => {
  assert.equal(parseBtQuery('{{bt-query: due="overdue"}}').filters.due, "overdue");
  assert.equal(parseBtQuery('{{bt-query: due="2026-08-01"}}').filters.due, "2026-08-01");
  assert.equal(
    parseBtQuery('{{bt-query: due="2026-08-01..2026-08-31"}}').filters.due,
    "2026-08-01..2026-08-31"
  );
  const bad = parseBtQuery('{{bt-query: due="someday"}}');
  assert.equal(bad.errors[0].code, "badValue");
});

test("completed accepts its named buckets", () => {
  assert.equal(
    parseBtQuery('{{bt-query: completed="last-7-days"}}').filters.completed,
    "last-7-days"
  );
  const bad = parseBtQuery('{{bt-query: completed="overdue"}}');
  assert.equal(bad.errors[0].code, "badValue", "due-only bucket rejected for completed");
});

test("blocked accepts blocked/actionable", () => {
  assert.equal(parseBtQuery('{{bt-query: blocked="actionable"}}').filters.blocked, "actionable");
  assert.equal(parseBtQuery('{{bt-query: blocked="Blocked"}}').filters.blocked, "blocked");
  assert.equal(parseBtQuery('{{bt-query: blocked="yes"}}').errors[0].code, "badValue");
});

test("limit must be a positive integer", () => {
  assert.equal(parseBtQuery("{{bt-query: limit=200}}").limit, 200);
  assert.equal(parseBtQuery("{{bt-query: limit=0}}").errors[0].code, "badValue");
  assert.equal(parseBtQuery("{{bt-query: limit=ten}}").errors[0].code, "badValue");
  assert.equal(parseBtQuery("{{bt-query: limit=2.5}}").errors[0].code, "badValue");
});

test("sort accepts only due in v1", () => {
  assert.equal(parseBtQuery('{{bt-query: sort="due"}}').sort, "due");
  assert.equal(parseBtQuery('{{bt-query: sort="title"}}').errors[0].code, "badValue");
});

// ========================= errors =========================

test("unknown keys are reported, valid keys still parse", () => {
  const r = parseBtQuery('{{bt-query: priority="high" status="TODO"}}');
  assert.deepEqual(r.errors, [{ code: "unknownKey", key: "priority" }]);
  assert.equal(r.filters.status, "TODO");
});

test("unterminated quote is a structured error, not a crash", () => {
  const r = parseBtQuery('{{bt-query: project="unclosed}}');
  assert.equal(r.isBtQuery, true);
  assert.equal(r.errors[0].code, "unterminated");
  assert.equal(r.errors[0].key, "project");
});

test("missing = is a syntax error", () => {
  const r = parseBtQuery("{{bt-query: status TODO}}");
  assert.equal(r.errors[0].code, "syntax");
});

test("multiple errors accumulate", () => {
  const r = parseBtQuery('{{bt-query: foo="1" bar="2" status="NOPE"}}');
  assert.equal(r.errors.length, 3);
});

test("last occurrence wins on duplicate keys", () => {
  const r = parseBtQuery('{{bt-query: status="TODO" status="DONE"}}');
  assert.equal(r.filters.status, "DONE");
  assert.deepEqual(r.errors, []);
});

// ========================= free text =========================

test("query and assignee pass through as free text", () => {
  const r = parseBtQuery('{{bt-query: query="deep work review" assignee="Sam"}}');
  assert.deepEqual(r.errors, []);
  assert.equal(r.filters.query, "deep work review");
  assert.equal(r.filters.assignee, "Sam");
});

test("invocation embedded in surrounding text still parses", () => {
  const r = parseBtQuery('Weekly focus: {{bt-query: due="this-week" limit=10}} (auto)');
  assert.equal(r.isBtQuery, true);
  assert.equal(r.filters.due, "this-week");
  assert.equal(r.limit, 10);
});

// ========================= contract =========================

test("KNOWN_KEYS matches the documented v1 vocabulary", () => {
  assert.deepEqual(
    [...KNOWN_KEYS].sort(),
    ["assignee", "blocked", "completed", "due", "limit", "project", "query", "sort", "status"]
  );
});
