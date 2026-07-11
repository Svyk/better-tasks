import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizePulledSubtree,
  flattenSubtreeToCreateSteps,
  collectTreeUids,
  countTaskBlocks,
  dropNestedSelections,
} from "../src/core/subtree.js";

// ========================= normalizePulledSubtree =========================

test("normalizePulledSubtree: returns null for null/undefined or missing uid", () => {
  assert.equal(normalizePulledSubtree(null), null);
  assert.equal(normalizePulledSubtree(undefined), null);
  assert.equal(normalizePulledSubtree({}), null, "no :block/uid");
  assert.equal(normalizePulledSubtree({ ":block/string": "x" }), null);
});

test("normalizePulledSubtree: applies defaults for missing string/order/children", () => {
  const n = normalizePulledSubtree({ ":block/uid": "root" });
  assert.equal(n.uid, "root");
  assert.equal(n.string, "");
  assert.equal(n.order, 0);
  assert.deepEqual(n.children, []);
  assert.equal(n.props, undefined);
  assert.equal(n.open, undefined);
  assert.equal(n.heading, undefined);
  assert.equal(n.textAlign, undefined);
});

test("normalizePulledSubtree: passes optional fields through only when present", () => {
  const props = { "do-on": "2026-07-11" };
  const n = normalizePulledSubtree({
    ":block/uid": "x",
    ":block/string": "hi",
    ":block/order": 3,
    ":block/props": props,
    ":block/open": false,
    ":block/heading": 2,
    ":block/text-align": "right",
  });
  assert.equal(n.uid, "x");
  assert.equal(n.string, "hi");
  assert.equal(n.order, 3);
  assert.equal(n.props, props, "same reference — not cloned");
  assert.equal(n.open, false);
  assert.equal(n.heading, 2);
  assert.equal(n.textAlign, "right");
});

test("normalizePulledSubtree: sorts children ascending by order at every depth when input is unsorted", () => {
  const raw = {
    ":block/uid": "root",
    ":block/children": [
      {
        ":block/uid": "c2",
        ":block/order": 2,
        ":block/children": [
          { ":block/uid": "g2", ":block/order": 2 },
          { ":block/uid": "g1", ":block/order": 1 },
          { ":block/uid": "g0", ":block/order": 0 },
        ],
      },
      {
        ":block/uid": "c0",
        ":block/order": 0,
        ":block/children": [
          { ":block/uid": "h1", ":block/order": 1 },
          { ":block/uid": "h0", ":block/order": 0 },
        ],
      },
      { ":block/uid": "c1", ":block/order": 1 },
    ],
  };
  const n = normalizePulledSubtree(raw);
  assert.deepEqual(n.children.map((c) => c.uid), ["c0", "c1", "c2"]);
  assert.deepEqual(n.children[0].children.map((c) => c.uid), ["h0", "h1"]);
  assert.deepEqual(n.children[1].children.map((c) => c.uid), []);
  assert.deepEqual(n.children[2].children.map((c) => c.uid), ["g0", "g1", "g2"]);
});

test("normalizePulledSubtree: stable sort preserves input order on ties", () => {
  const raw = {
    ":block/uid": "root",
    ":block/children": [
      { ":block/uid": "a", ":block/order": 1 },
      { ":block/uid": "b", ":block/order": 1 },
      { ":block/uid": "c", ":block/order": 1 },
    ],
  };
  const n = normalizePulledSubtree(raw);
  assert.deepEqual(n.children.map((c) => c.uid), ["a", "b", "c"]);
});

test("normalizePulledSubtree: drops null children from a malformed pull", () => {
  const raw = {
    ":block/uid": "root",
    ":block/children": [
      { ":block/uid": "ok", ":block/order": 0 },
      { ":block/string": "no uid" }, // becomes null
      null,
    ],
  };
  const n = normalizePulledSubtree(raw);
  assert.deepEqual(n.children.map((c) => c.uid), ["ok"]);
});

// ========================= flattenSubtreeToCreateSteps =========================

test("flattenSubtreeToCreateSteps: returns [] for null/undefined", () => {
  assert.deepEqual(flattenSubtreeToCreateSteps(null, "P"), []);
  assert.deepEqual(flattenSubtreeToCreateSteps(undefined, "P"), []);
});

test("flattenSubtreeToCreateSteps: parent before child, siblings ascending, on a 3-level tree", () => {
  // root(order 0) -> [a(order 1) -> [a1(order 0), a2(order 1)], b(order 0)]
  const tree = normalizePulledSubtree({
    ":block/uid": "root",
    ":block/order": 0,
    ":block/string": "root",
    ":block/children": [
      {
        ":block/uid": "b",
        ":block/order": 0,
        ":block/string": "b",
        ":block/children": [],
      },
      {
        ":block/uid": "a",
        ":block/order": 1,
        ":block/string": "a",
        ":block/children": [
          { ":block/uid": "a2", ":block/order": 1, ":block/string": "a2", ":block/children": [] },
          { ":block/uid": "a1", ":block/order": 0, ":block/string": "a1", ":block/children": [] },
        ],
      },
    ],
  });
  const steps = flattenSubtreeToCreateSteps(tree, "PARENT");
  assert.deepEqual(
    steps.map((s) => s.uid),
    ["root", "b", "a", "a1", "a2"],
    "depth-first pre-order, siblings ascending",
  );

  // Each step's parentUid is either the argument or an earlier step's uid.
  const seenUids = new Set();
  for (const s of steps) {
    assert.ok(
      s.parentUid === "PARENT" || seenUids.has(s.parentUid),
      `parentUid ${s.parentUid} for ${s.uid} is not the argument or an earlier step`,
    );
    seenUids.add(s.uid);
  }

  assert.deepEqual(steps[0], { parentUid: "PARENT", order: 0, string: "root", uid: "root" });
  assert.deepEqual(steps[1], { parentUid: "root", order: 0, string: "b", uid: "b" });
  assert.deepEqual(steps[2], { parentUid: "root", order: 1, string: "a", uid: "a" });
  assert.deepEqual(steps[3], { parentUid: "a", order: 0, string: "a1", uid: "a1" });
  assert.deepEqual(steps[4], { parentUid: "a", order: 1, string: "a2", uid: "a2" });
});

// ========================= collectTreeUids =========================

test("collectTreeUids: returns [] for null/undefined", () => {
  assert.deepEqual(collectTreeUids(null), []);
  assert.deepEqual(collectTreeUids(undefined), []);
});

test("collectTreeUids: root first, depth-first pre-order", () => {
  const tree = normalizePulledSubtree({
    ":block/uid": "root",
    ":block/children": [
      {
        ":block/uid": "b",
        ":block/order": 1,
        ":block/children": [{ ":block/uid": "b1", ":block/order": 0 }],
      },
      {
        ":block/uid": "a",
        ":block/order": 0,
        ":block/children": [
          { ":block/uid": "a2", ":block/order": 1 },
          { ":block/uid": "a1", ":block/order": 0 },
        ],
      },
    ],
  });
  assert.deepEqual(collectTreeUids(tree), ["root", "a", "a1", "a2", "b", "b1"]);
});

// ========================= countTaskBlocks =========================

test("countTaskBlocks: returns 0 for null/undefined", () => {
  assert.equal(countTaskBlocks(null), 0);
  assert.equal(countTaskBlocks(undefined), 0);
});

test("countTaskBlocks: recognises all four macro forms, case-sensitive", () => {
  const tree = normalizePulledSubtree({
    ":block/uid": "root",
    ":block/string": "container",
    ":block/children": [
      { ":block/uid": "t1", ":block/string": "{{[[TODO]]}} brush teeth" },
      { ":block/uid": "t2", ":block/string": "{{TODO}} shorthand form" },
      { ":block/uid": "t3", ":block/string": "{{[[DONE]]}} already did it" },
      { ":block/uid": "t4", ":block/string": "{{DONE}} shorthand done" },
      { ":block/uid": "n1", ":block/string": "just a note" },
      { ":block/uid": "n2", ":block/string": "{{todo}} lower case is NOT a match" },
    ],
  });
  assert.equal(countTaskBlocks(tree), 4, "excludeRoot true: root is a non-task anyway");
});

test("countTaskBlocks: excludeRoot true skips a task root", () => {
  const tree = normalizePulledSubtree({
    ":block/uid": "root",
    ":block/string": "{{[[TODO]]}} root task",
    ":block/children": [
      { ":block/uid": "c1", ":block/string": "{{TODO}} child" },
      { ":block/uid": "c2", ":block/string": "not a task" },
    ],
  });
  assert.equal(countTaskBlocks(tree), 1, "default excludeRoot true");
  assert.equal(countTaskBlocks(tree, { excludeRoot: true }), 1, "explicit true");
  assert.equal(countTaskBlocks(tree, { excludeRoot: false }), 2, "explicit false counts root");
});

test("countTaskBlocks: mixed task and non-task nodes at multiple depths", () => {
  const tree = normalizePulledSubtree({
    ":block/uid": "root",
    ":block/string": "Inbox",
    ":block/children": [
      {
        ":block/uid": "a",
        ":block/string": "{{[[DONE]]}} done",
        ":block/children": [
          { ":block/uid": "a1", ":block/string": "{{TODO}} nested todo" },
          { ":block/uid": "a2", ":block/string": "plain" },
        ],
      },
      { ":block/uid": "b", ":block/string": "{{DONE}} sibling done" },
    ],
  });
  assert.equal(countTaskBlocks(tree), 3, "root excluded → a, a1, b");
  assert.equal(countTaskBlocks(tree, { excludeRoot: false }), 3, "root is not a task → same count");
});

// ========================= dropNestedSelections =========================

test("dropNestedSelections: no nesting — all kept, order preserved", () => {
  const map = {
    A: ["A"],
    B: ["B"],
    C: ["C"],
  };
  assert.deepEqual(dropNestedSelections(["C", "A", "B"], map), ["C", "A", "B"]);
});

test("dropNestedSelections: parent + child selected → child dropped", () => {
  const map = {
    A: ["A", "B"],
    B: ["B"],
  };
  assert.deepEqual(dropNestedSelections(["A", "B"], map), ["A"]);
  assert.deepEqual(dropNestedSelections(["B", "A"], map), ["A"], "B is in A's tree → dropped regardless of order");
});

test("dropNestedSelections: chain A > B > C collapses to outermost ancestor", () => {
  const map = {
    A: ["A", "B", "C"],
    B: ["B", "C"],
    C: ["C"],
  };
  assert.deepEqual(dropNestedSelections(["A", "B", "C"], map), ["A"]);
  assert.deepEqual(dropNestedSelections(["C", "B", "A"], map), ["A"], "A swallows C and B regardless of input order");
  assert.deepEqual(dropNestedSelections(["B", "A", "C"], map), ["A"], "A swallows B and C regardless of input order");
});

test("dropNestedSelections: duplicate inputs are de-duplicated, first occurrence wins", () => {
  const map = { A: ["A"], B: ["B"] };
  assert.deepEqual(dropNestedSelections(["A", "B", "A", "B", "A"], map), ["A", "B"]);
});

test("dropNestedSelections: works with a Map form of uidToTreeUids", () => {
  const map = new Map([
    ["A", ["A", "B"]],
    ["B", ["B"]],
  ]);
  assert.deepEqual(dropNestedSelections(["A", "B"], map), ["A"]);
  assert.deepEqual(dropNestedSelections(["B", "A"], map), ["A"], "B is in A's tree → dropped regardless of order");
});

test("dropNestedSelections: a uid absent from the map is kept unless another selection's tree contains it", () => {
  const map = {
    A: ["A", "B"],
  };
  assert.deepEqual(dropNestedSelections(["A", "B"], map), ["A"], "B is in A's tree → dropped");
  assert.deepEqual(dropNestedSelections(["B", "C"], map), ["B", "C"], "neither has a map entry, no nesting → both kept");
  assert.deepEqual(dropNestedSelections(["C", "D"], {}), ["C", "D"], "empty map, both kept");
});

test("dropNestedSelections: non-array input returns []", () => {
  assert.deepEqual(dropNestedSelections(null, {}), []);
  assert.deepEqual(dropNestedSelections(undefined, {}), []);
});
