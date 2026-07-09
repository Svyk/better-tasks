import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSV_HEADERS,
  escapeCSV,
  buildCSVContent,
  buildJSONContent,
  escapeICSText,
  foldICSLine,
  toICSDate,
  formatICSTimestamp,
  buildICSContent,
} from "../src/core/export.js";

const NOW = new Date(Date.UTC(2026, 6, 9, 10, 30, 0)); // 2026-07-09T10:30:00Z
const ICS = (tasks) => buildICSContent(tasks, { now: NOW });

const task = (over = {}) => ({
  uid: "abc123",
  title: "Task",
  status: "TODO",
  due: "2026-07-20",
  attributes: {},
  ...over,
});

const octets = (s) => new TextEncoder().encode(s).length;
// RFC 5545 unfolding: remove CRLF followed by a single leading space.
const unfold = (s) => s.replace(/\r\n /g, "");
const lineOf = (content, prefix) =>
  unfold(content).split("\r\n").find((l) => l.startsWith(prefix));

// ========================= ICS text escaping =========================

test("escapeICSText escapes backslash, semicolon, comma and newlines", () => {
  assert.equal(escapeICSText("a,b"), "a\\,b");
  assert.equal(escapeICSText("a;b"), "a\\;b");
  assert.equal(escapeICSText("a\\b"), "a\\\\b");
  assert.equal(escapeICSText("a\nb"), "a\\nb");
  assert.equal(escapeICSText("a\r\nb"), "a\\nb");
  // Backslash must be escaped first, or the escapes escape each other
  assert.equal(escapeICSText("\\,"), "\\\\\\,");
  // Colon and double-quote are TSAFE and must NOT be escaped
  assert.equal(escapeICSText('a:b"c'), 'a:b"c');
  assert.equal(escapeICSText(null), "");
});

test("SUMMARY escapes commas in ordinary task titles", () => {
  const { content } = ICS([task({ title: "Buy milk, eggs" })]);
  assert.equal(lineOf(content, "SUMMARY:"), "SUMMARY:Buy milk\\, eggs");
});

test("SUMMARY escapes semicolons, backslashes and newlines", () => {
  const { content } = ICS([task({ title: "Review: a; b \\ c\nsecond line" })]);
  assert.equal(lineOf(content, "SUMMARY:"), "SUMMARY:Review: a\\; b \\\\ c\\nsecond line");
});

test("SUMMARY escaping survives the [DONE] and [project] suffixes", () => {
  const { content } = ICS([
    task({ title: "Ship, now", status: "DONE", attributes: { project: "Home, Errands" } }),
  ]);
  assert.equal(lineOf(content, "SUMMARY:"), "SUMMARY:Ship\\, now [DONE] [Home\\, Errands]");
});

test("CATEGORIES escapes a comma so one project stays one category", () => {
  const { content } = ICS([task({ attributes: { project: "Home, Errands" } })]);
  assert.equal(lineOf(content, "CATEGORIES:"), "CATEGORIES:Home\\, Errands");
});

// ========================= DTSTAMP =========================

test("every VEVENT carries a DTSTAMP (required by RFC 5545 3.6.1)", () => {
  const { content } = ICS([task(), task({ uid: "def456", due: "2026-08-01" })]);
  const stamps = content.split("\r\n").filter((l) => l.startsWith("DTSTAMP:"));
  const events = content.split("\r\n").filter((l) => l === "BEGIN:VEVENT");
  assert.equal(events.length, 2);
  assert.equal(stamps.length, 2);
  assert.equal(stamps[0], "DTSTAMP:20260709T103000Z");
});

test("formatICSTimestamp emits a UTC date-time", () => {
  assert.equal(formatICSTimestamp(new Date(Date.UTC(2026, 0, 5, 4, 3, 2))), "20260105T040302Z");
});

// ========================= Line folding =========================

test("foldICSLine leaves short lines untouched", () => {
  assert.equal(foldICSLine("SUMMARY:short"), "SUMMARY:short");
  const exactly75 = "A".repeat(75);
  assert.equal(foldICSLine(exactly75), exactly75);
});

test("foldICSLine folds long lines to <=75 octets with a continuation space", () => {
  const folded = foldICSLine("SUMMARY:" + "A".repeat(200));
  const parts = folded.split("\r\n");
  assert.ok(parts.length > 1, "expected the line to fold");
  for (const p of parts) assert.ok(octets(p) <= 75, `line of ${octets(p)} octets exceeds 75`);
  for (const p of parts.slice(1)) assert.ok(p.startsWith(" "), "continuation must start with a space");
  assert.equal(unfold(folded), "SUMMARY:" + "A".repeat(200));
});

test("foldICSLine never splits a multi-byte UTF-8 sequence", () => {
  const folded = foldICSLine("SUMMARY:" + "🌀".repeat(40)); // 4 octets each
  for (const p of folded.split("\r\n")) assert.ok(octets(p) <= 75);
  assert.equal(unfold(folded), "SUMMARY:" + "🌀".repeat(40));
  assert.ok(!folded.includes("�"), "no replacement chars — sequence was split");
});

test("buildICSContent folds long titles in situ", () => {
  const { content } = ICS([task({ title: "X".repeat(200) })]);
  for (const line of content.split("\r\n")) assert.ok(octets(line) <= 75);
  assert.ok(unfold(content).includes("SUMMARY:" + "X".repeat(200)));
});

// ========================= ICS structure =========================

test("all-day DTEND is DTSTART + 1 day, including across month and year ends", () => {
  assert.equal(lineOf(ICS([task({ due: "2026-07-20" })]).content, "DTEND"), "DTEND;VALUE=DATE:20260721");
  assert.equal(lineOf(ICS([task({ due: "2026-12-31" })]).content, "DTEND"), "DTEND;VALUE=DATE:20270101");
  assert.equal(lineOf(ICS([task({ due: "2028-02-28" })]).content, "DTEND"), "DTEND;VALUE=DATE:20280229");
});

test("date precedence is due > defer > start", () => {
  const t = task({ due: "2026-07-20", defer: "2026-07-10", start: "2026-07-01" });
  assert.equal(lineOf(ICS([t]).content, "DTSTART"), "DTSTART;VALUE=DATE:20260720");
  const noDue = task({ due: null, defer: "2026-07-10", start: "2026-07-01" });
  assert.equal(lineOf(ICS([noDue]).content, "DTSTART"), "DTSTART;VALUE=DATE:20260710");
});

test("tasks with no dates are skipped and counted", () => {
  const r = ICS([task(), task({ uid: "n1", due: null }), task({ uid: "n2", due: null })]);
  assert.equal(r.count, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.content.split("\r\n").filter((l) => l === "BEGIN:VEVENT").length, 1);
});

test("status maps to CONFIRMED / TENTATIVE", () => {
  assert.ok(ICS([task({ status: "DONE" })]).content.includes("STATUS:CONFIRMED"));
  assert.ok(ICS([task({ status: "TODO" })]).content.includes("STATUS:TENTATIVE"));
});

test("calendar is well-formed and CRLF-delimited", () => {
  const { content } = ICS([task()]);
  const lines = content.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-1), "END:VCALENDAR");
  assert.ok(content.includes("VERSION:2.0"));
  assert.ok(!content.includes("\n\n"));
  // every LF is part of a CRLF pair
  assert.equal(content.split("\n").length - 1, content.split("\r\n").length - 1);
});

test("empty task list still yields a valid empty calendar", () => {
  const r = ICS([]);
  assert.equal(r.count, 0);
  assert.equal(r.skipped, 0);
  assert.equal(r.content, "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//BetterTasks//Roam Research//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Better Tasks\r\nEND:VCALENDAR");
});

test("toICSDate strips hyphens, passes through empty", () => {
  assert.equal(toICSDate("2026-07-20"), "20260720");
  assert.equal(toICSDate(null), null);
  assert.equal(toICSDate(""), null);
});

// ========================= CSV =========================

test("CSV header row is stable", () => {
  const { content } = buildCSVContent([]);
  assert.equal(content, CSV_HEADERS.join(","));
});

test("escapeCSV quotes only when needed, and doubles embedded quotes", () => {
  assert.equal(escapeCSV("plain"), "plain");
  assert.equal(escapeCSV("a,b"), '"a,b"');
  assert.equal(escapeCSV('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCSV("line\nbreak"), '"line\nbreak"');
  assert.equal(escapeCSV("carriage\rreturn"), '"carriage\rreturn"');
});

test("CSV row serialises attributes, joins lists with '; ' and stringifies booleans", () => {
  const { content } = buildCSVContent([
    task({
      title: "Buy milk, eggs",
      attributes: { project: "Home", context: ["errands", "town"], depends: ["u1", "u2"] },
      is_blocked: true,
      subtask_uids: ["s1", "s2"],
    }),
  ]);
  const row = content.split("\n")[1];
  assert.ok(row.includes('"Buy milk, eggs"'), "comma-bearing title must be quoted");
  assert.ok(row.includes("errands; town"));
  assert.ok(row.includes("u1; u2"));
  assert.ok(row.includes("s1; s2"));
  assert.ok(row.includes(",true,"));
});

test("CSV row count matches task count", () => {
  const { content, count } = buildCSVContent([task(), task({ uid: "b" })]);
  assert.equal(count, 2);
  assert.equal(content.split("\n").length, 3); // header + 2
});

// ========================= JSON =========================

test("buildJSONContent pretty-prints and round-trips", () => {
  const tasks = [task({ title: "Buy milk, eggs" })];
  const { content, count } = buildJSONContent(tasks);
  assert.equal(count, 1);
  assert.deepEqual(JSON.parse(content), tasks);
  assert.ok(content.includes("\n  "), "expected 2-space indentation");
});
