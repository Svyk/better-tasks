import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDependsValue,
  formatDependsValue,
  findPath,
  wouldCreateCycle,
  computeBlockedState,
  DEFAULT_MAX_NODES,
} from "../src/core/dependencies.js";

// A graph is { uid: [depUids] }. A uid absent from the graph = deleted block.
const depsOf = (graph) => async (uid) => (uid in graph ? graph[uid] : null);

// ========================= parse / format =========================

test("parseDependsValue extracts block refs", () => {
  assert.deepEqual(parseDependsValue("((abc123)), ((def-456))"), ["abc123", "def-456"]);
  assert.deepEqual(parseDependsValue("((one))"), ["one"]);
  assert.deepEqual(parseDependsValue("  ((a))  ,  ((b))  "), ["a", "b"], "tolerates whitespace");
  assert.deepEqual(parseDependsValue("((a_b-C9))"), ["a_b-C9"], "Roam uid charset");
});

test("parseDependsValue rejects anything that is not a bare block ref", () => {
  assert.deepEqual(parseDependsValue("abc"), []);
  assert.deepEqual(parseDependsValue("[[page]]"), []);
  assert.deepEqual(parseDependsValue("((a)) trailing"), []);
  assert.deepEqual(parseDependsValue("((bad uid))"), [], "spaces are not valid in a uid");
  assert.deepEqual(parseDependsValue(""), []);
  assert.deepEqual(parseDependsValue(null), []);
  assert.deepEqual(parseDependsValue(42), []);
  assert.deepEqual(parseDependsValue("((a)), garbage, ((b))"), ["a", "b"], "drops only the bad token");
});

test("formatDependsValue round-trips with parseDependsValue", () => {
  assert.equal(formatDependsValue(["a", "b"]), "((a)), ((b))");
  assert.equal(formatDependsValue([]), "");
  assert.equal(formatDependsValue(null), "");
  assert.deepEqual(parseDependsValue(formatDependsValue(["x1", "y-2"])), ["x1", "y-2"]);
});

// ========================= findPath =========================

test("findPath finds direct, transitive and no-path cases", async () => {
  const g = { A: ["B"], B: ["C"], C: [], D: [] };
  assert.equal((await findPath("A", "B", depsOf(g))).found, true, "direct");
  assert.equal((await findPath("A", "C", depsOf(g))).found, true, "transitive");
  assert.equal((await findPath("A", "D", depsOf(g))).found, false);
  assert.equal((await findPath("C", "A", depsOf(g))).found, false, "edges are directed");
});

test("findPath treats a deleted block as a dead end, not an error", async () => {
  const g = { A: ["GHOST", "B"], B: ["C"], C: [] };
  const r = await findPath("A", "C", depsOf(g));
  assert.equal(r.found, true);
  assert.equal(r.truncated, false);
});

test("findPath terminates on a graph that is itself cyclic", async () => {
  const g = { A: ["B"], B: ["A"] }; // searching for something not present
  const r = await findPath("A", "ZZZ", depsOf(g));
  assert.equal(r.found, false);
  assert.equal(r.truncated, false, "visited set prevents an infinite loop");
  assert.equal(r.visited, 2);
});

test("findPath reports truncation instead of a false negative", async () => {
  const chain = { A: ["N1"] };
  for (let i = 1; i <= 100; i++) chain[`N${i}`] = [i < 100 ? `N${i + 1}` : "A"];
  const tight = await findPath("N1", "A", depsOf(chain), { maxNodes: 10 });
  assert.equal(tight.found, false);
  assert.equal(tight.truncated, true, "found:false + truncated:true means 'don't know'");

  const roomy = await findPath("N1", "A", depsOf(chain), { maxNodes: 500 });
  assert.equal(roomy.found, true);
  assert.equal(roomy.truncated, false);
});

test("findPath does not truncate when the answer is within budget", async () => {
  const g = { A: ["B"], B: ["C"], C: [] };
  const r = await findPath("A", "C", depsOf(g), { maxNodes: 3 });
  assert.equal(r.found, true);
  assert.equal(r.truncated, false);
});

// ========================= wouldCreateCycle =========================

test("wouldCreateCycle: self-reference", async () => {
  const r = await wouldCreateCycle("A", "A", depsOf({}));
  assert.deepEqual(r, { cycle: true, truncated: false });
});

test("wouldCreateCycle: mutual and transitive cycles", async () => {
  // Adding A -> B when B already depends on A
  assert.equal((await wouldCreateCycle("A", "B", depsOf({ B: ["A"] }))).cycle, true, "mutual");
  // Adding A -> B when B -> C -> A
  assert.equal((await wouldCreateCycle("A", "B", depsOf({ B: ["C"], C: ["A"] }))).cycle, true, "transitive");
});

test("wouldCreateCycle: a diamond is not a cycle", async () => {
  //   B and C both depend on D; adding A -> B is safe.
  const g = { B: ["D"], C: ["D"], D: [] };
  assert.equal((await wouldCreateCycle("A", "B", depsOf(g))).cycle, false);
});

test("wouldCreateCycle: an unrelated cycle elsewhere in the graph is not our cycle", async () => {
  const g = { B: ["C"], C: ["B"] }; // B and C loop, but neither reaches A
  const r = await wouldCreateCycle("A", "B", depsOf(g));
  assert.equal(r.cycle, false);
  assert.equal(r.truncated, false, "the visited set must stop the traversal");
});

test("wouldCreateCycle: a deep chain is detected (regression — the old budget was 20 nodes)", async () => {
  const chain = { A: ["N1"] };
  for (let i = 1; i <= 40; i++) chain[`N${i}`] = [i < 40 ? `N${i + 1}` : "A"];
  assert.equal((await wouldCreateCycle("A", "N1", depsOf(chain))).cycle, true);
});

test("wouldCreateCycle: a wide fan-out is detected (regression — DFS explored the cycle branch last)", async () => {
  // A -> B -> [X0..X24], and only X0 loops back to A. DFS pops last-pushed
  // first, so X0 is explored after 25 expansions — past the old budget of 20.
  const g = { A: ["B"], B: Array.from({ length: 25 }, (_, i) => `X${i}`) };
  for (let i = 0; i < 25; i++) g[`X${i}`] = i === 0 ? ["A"] : [];
  assert.equal((await wouldCreateCycle("A", "B", depsOf(g))).cycle, true);
  // With the old budget it is undetectable — but now it says so.
  const tight = await wouldCreateCycle("A", "B", depsOf(g), { maxNodes: 20 });
  assert.deepEqual(tight, { cycle: false, truncated: true });
});

test("DEFAULT_MAX_NODES is generous enough for real graphs", () => {
  assert.ok(DEFAULT_MAX_NODES >= 500);
});

// ========================= computeBlockedState =========================

const tasksOf = (map) => async (uid) => (uid in map ? map[uid] : null);

test("computeBlockedState: no dependencies means not blocked", async () => {
  for (const deps of [[], null, undefined, "nope"]) {
    const r = await computeBlockedState(deps, "A", {});
    assert.deepEqual(r, { blocked: false, blockedBy: [], staleUids: [], truncated: false });
  }
});

test("computeBlockedState: an incomplete dependency blocks", async () => {
  const tasks = { B: { completed: false, title: "Do B" } };
  const r = await computeBlockedState(["B"], "A", { getTask: tasksOf(tasks), getDeps: depsOf({ B: [] }) });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.blockedBy, [{ uid: "B", title: "Do B" }]);
  assert.deepEqual(r.staleUids, []);
});

test("computeBlockedState: a completed dependency does not block", async () => {
  const tasks = { B: { completed: true, title: "Done B" } };
  const r = await computeBlockedState(["B"], "A", { getTask: tasksOf(tasks), getDeps: depsOf({ B: [] }) });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.blockedBy, []);
});

test("computeBlockedState: a deleted dependency is reported stale and does not block", async () => {
  const r = await computeBlockedState(["GONE"], "A", { getTask: tasksOf({}), getDeps: depsOf({}) });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.staleUids, ["GONE"]);
});

test("computeBlockedState: a cyclic dependency does not block, or the ring deadlocks", async () => {
  // A depends on B; B depends on A. Neither may block the other.
  const tasks = { B: { completed: false, title: "B" } };
  const r = await computeBlockedState(["B"], "A", { getTask: tasksOf(tasks), getDeps: depsOf({ B: ["A"], A: ["B"] }) });
  assert.equal(r.blocked, false, "the cycle is skipped");
  assert.deepEqual(r.blockedBy, []);
});

test("computeBlockedState: mixes blocking, completed, stale and cyclic deps", async () => {
  const tasks = {
    OPEN: { completed: false, title: "Open" },
    DONE: { completed: true, title: "Done" },
    CYCLE: { completed: false, title: "Cycle" },
  };
  const graph = { OPEN: [], DONE: [], CYCLE: ["A"] };
  const r = await computeBlockedState(["OPEN", "DONE", "GONE", "CYCLE"], "A", {
    getTask: tasksOf(tasks), getDeps: depsOf(graph),
  });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.blockedBy, [{ uid: "OPEN", title: "Open" }]);
  assert.deepEqual(r.staleUids, ["GONE"]);
});

test("computeBlockedState: without a taskUid, cycles are not checked", async () => {
  const tasks = { B: { completed: false, title: "B" } };
  const r = await computeBlockedState(["B"], null, { getTask: tasksOf(tasks), getDeps: depsOf({ B: ["A"] }) });
  assert.equal(r.blocked, true, "no taskUid → no cycle check → B blocks");
});

test("computeBlockedState surfaces truncation from the cycle search", async () => {
  const chain = { B: ["N1"] };
  for (let i = 1; i <= 60; i++) chain[`N${i}`] = [i < 60 ? `N${i + 1}` : "A"];
  const tasks = { B: { completed: false, title: "B" } };
  const r = await computeBlockedState(["B"], "A", {
    getTask: tasksOf(tasks), getDeps: depsOf(chain), maxNodes: 10,
  });
  assert.equal(r.truncated, true, "caller must know the verdict was not exhaustive");
  assert.equal(r.blocked, true, "a truncated search still blocks — the safe direction here");
});
