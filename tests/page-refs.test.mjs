import { test } from "node:test";
import assert from "node:assert/strict";
import {
  wrapAsPageRef,
  splitRefAwareList,
  formatContextListForWrite,
} from "../src/core/page-refs.js";

// ========================= wrapAsPageRef =========================

test("wrapAsPageRef wraps a plain title", () => {
  assert.equal(wrapAsPageRef("Website Refresh"), "[[Website Refresh]]");
});

test("wrapAsPageRef is idempotent on bracketed values", () => {
  assert.equal(wrapAsPageRef("[[Website Refresh]]"), "[[Website Refresh]]");
  assert.equal(wrapAsPageRef(wrapAsPageRef("X")), "[[X]]");
});

test("wrapAsPageRef converts tags to page refs", () => {
  assert.equal(wrapAsPageRef("#calls"), "[[calls]]");
  assert.equal(wrapAsPageRef("#[[Deep Work]]"), "[[Deep Work]]");
});

test("wrapAsPageRef trims whitespace", () => {
  assert.equal(wrapAsPageRef("  Home  "), "[[Home]]");
  assert.equal(wrapAsPageRef("  [[Home]]  "), "[[Home]]");
});

test("wrapAsPageRef returns empty string for empty or non-string input", () => {
  assert.equal(wrapAsPageRef(""), "");
  assert.equal(wrapAsPageRef("   "), "");
  assert.equal(wrapAsPageRef(null), "");
  assert.equal(wrapAsPageRef(undefined), "");
  assert.equal(wrapAsPageRef(42), "");
  assert.equal(wrapAsPageRef("#"), "");
});

test("wrapAsPageRef leaves a single outer ref with nested refs unchanged", () => {
  assert.equal(wrapAsPageRef("[[Project [[Sub]]]]"), "[[Project [[Sub]]]]");
});

test("wrapAsPageRef preserves commas inside titles", () => {
  assert.equal(wrapAsPageRef("July 12th, 2026"), "[[July 12th, 2026]]");
});

// ========================= splitRefAwareList =========================

test("splitRefAwareList splits plain comma lists", () => {
  assert.deepEqual(splitRefAwareList("Home, Deep Work"), ["Home", "Deep Work"]);
});

test("splitRefAwareList keeps commas inside [[...]] atomic", () => {
  assert.deepEqual(splitRefAwareList("[[July 12th, 2026]], [[Home]]"), [
    "[[July 12th, 2026]]",
    "[[Home]]",
  ]);
});

test("splitRefAwareList handles mixed bracketed and plain tokens", () => {
  assert.deepEqual(splitRefAwareList("Home, [[Deep, Focused Work]], @calls"), [
    "Home",
    "[[Deep, Focused Work]]",
    "@calls",
  ]);
});

test("splitRefAwareList handles nested refs", () => {
  assert.deepEqual(splitRefAwareList("[[Outer [[Inner, Part]]]], Plain"), [
    "[[Outer [[Inner, Part]]]]",
    "Plain",
  ]);
});

test("splitRefAwareList drops empty tokens and trims", () => {
  assert.deepEqual(splitRefAwareList(" a , , b ,"), ["a", "b"]);
  assert.deepEqual(splitRefAwareList(""), []);
  assert.deepEqual(splitRefAwareList("   "), []);
  assert.deepEqual(splitRefAwareList(null), []);
});

test("splitRefAwareList tolerates unbalanced brackets", () => {
  // A stray "[[" never closes: the rest of the string is one token.
  assert.deepEqual(splitRefAwareList("[[broken, value"), ["[[broken, value"]);
  // A stray "]]" at depth 0 is treated as literal text.
  assert.deepEqual(splitRefAwareList("a]], b"), ["a]]", "b"]);
});

// ========================= formatContextListForWrite =========================

test("formatContextListForWrite wraps each item", () => {
  assert.equal(formatContextListForWrite(["Home", "Deep Work"]), "[[Home]], [[Deep Work]]");
});

test("formatContextListForWrite is idempotent with pre-bracketed items", () => {
  assert.equal(formatContextListForWrite(["[[Home]]", "#calls"]), "[[Home]], [[calls]]");
});

test("formatContextListForWrite skips empty items", () => {
  assert.equal(formatContextListForWrite(["Home", "", "  "]), "[[Home]]");
  assert.equal(formatContextListForWrite([]), "");
  assert.equal(formatContextListForWrite(null), "");
});

// ========================= round-trip =========================

test("wrap → split → strip round-trips comma-containing titles", () => {
  const items = ["July 12th, 2026", "Home"];
  const written = formatContextListForWrite(items);
  const tokens = splitRefAwareList(written);
  const stripped = tokens.map((t) => {
    const m = t.match(/^\[\[(.*)\]\]$/);
    return m ? m[1].trim() : t;
  });
  assert.deepEqual(stripped, items);
});
