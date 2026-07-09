import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flattenLeaves,
  isUntranslatable,
  findUntranslated,
  groupByLocale,
  DEFAULT_VALUE_ALLOWLIST,
} from "../src/core/i18n-audit.js";

test("flattenLeaves produces dotted paths", () => {
  assert.deepEqual(flattenLeaves({ a: { b: { c: "x" } }, d: "y" }), { "a.b.c": "x", d: "y" });
  assert.deepEqual(flattenLeaves({}), {});
  assert.deepEqual(flattenLeaves(null), {});
});

test("isUntranslatable: interpolation-only values carry no language", () => {
  assert.equal(isUntranslatable("{{field}} → {{to}}"), true);
  assert.equal(isUntranslatable("{{count}}/{{total}}"), true);
  assert.equal(isUntranslatable("—"), true);
  assert.equal(isUntranslatable("📋"), true);
  assert.equal(isUntranslatable("+1d"), false, "'d' is a translatable abbreviation");
  assert.equal(isUntranslatable(""), true);
  assert.equal(isUntranslatable("  "), true);
});

test("isUntranslatable: a placeholder plus real words is still translatable", () => {
  assert.equal(isUntranslatable("Due {{date}}"), false);
  assert.equal(isUntranslatable("{{n}} tasks"), false);
});

test("isUntranslatable: allowlisted brand names and acronyms", () => {
  for (const value of DEFAULT_VALUE_ALLOWLIST) assert.equal(isUntranslatable(value), true);
  assert.equal(isUntranslatable("Better Tasks"), true);
  assert.equal(isUntranslatable("GTD"), true);
  assert.equal(isUntranslatable("Dashboard"), false);
  // A custom allowlist replaces the default
  assert.equal(isUntranslatable("GTD", ["Only This"]), false);
});

test("isUntranslatable: non-strings are ignored", () => {
  assert.equal(isUntranslatable(42), true);
  assert.equal(isUntranslatable(null), true);
  assert.equal(isUntranslatable(undefined), true);
});

const I18N = {
  en: { a: "Save", b: "GTD", c: "{{x}} → {{y}}", d: "Tags", e: "Notes" },
  fr: { a: "Enregistrer", b: "GTD", c: "{{x}} → {{y}}", d: "Tags", e: "Notes" },
  de: { a: "Save", b: "GTD", c: "{{x}} → {{y}}", d: "Schlagwörter", e: "Notizen" },
};

test("findUntranslated flags English values, skipping untranslatable ones", () => {
  const found = findUntranslated(I18N);
  // fr.d ("Tags") and fr.e ("Notes") match English and are translatable → flagged.
  // de.a ("Save") matches English → flagged. GTD and the interpolation are skipped.
  assert.deepEqual(found.map((f) => `${f.locale}.${f.key}`).sort(), ["de.a", "fr.d", "fr.e"]);
});

test("findUntranslated honours the per-locale cognate allowlist", () => {
  const found = findUntranslated(I18N, { localeAllowlist: { fr: ["d", "e"] } });
  assert.deepEqual(found.map((f) => `${f.locale}.${f.key}`), ["de.a"]);
});

test("findUntranslated honours the global key allowlist", () => {
  const found = findUntranslated(I18N, { keyAllowlist: ["a", "d", "e"] });
  assert.deepEqual(found, []);
});

test("findUntranslated ignores keys missing from a locale (parity's job)", () => {
  const partial = { en: { a: "Save", b: "Delete" }, fr: { a: "Save" } };
  const found = findUntranslated(partial);
  assert.deepEqual(found.map((f) => f.key), ["a"]);
});

test("findUntranslated never reports the base locale, and honours a custom base", () => {
  assert.equal(findUntranslated(I18N).some((f) => f.locale === "en"), false);
  const found = findUntranslated({ fr: { a: "Sauver" }, en: { a: "Sauver" } }, { base: "fr" });
  assert.deepEqual(found.map((f) => f.locale), ["en"]);
});

test("a fully translated locale set yields no findings", () => {
  const clean = { en: { a: "Save" }, fr: { a: "Enregistrer" } };
  assert.deepEqual(findUntranslated(clean), []);
});

test("groupByLocale buckets findings", () => {
  const grouped = groupByLocale(findUntranslated(I18N));
  assert.deepEqual([...grouped.keys()], ["de", "fr"]);
  assert.equal(grouped.get("fr").length, 2);
});
