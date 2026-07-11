// Pure subtree snapshot/rebuild logic for Better Tasks.
//
// Supports the task-deletion undo path: a Roam block subtree is captured via a
// recursive datascript pull before deletion, then rebuilt on undo. This module
// only shapes and walks the captured tree — it knows nothing about Roam, the
// DOM, or any injected accessors. Zero dependencies.

/**
 * Normalize a single node from a Roam recursive pull.
 *
 * The pull returns keyword-keyed maps (`:block/uid`, `:block/string`, …) with
 * `:block/children` arriving UNSORTED. This function produces a stable shape
 * and sorts children ascending by `order` at every depth. Ties keep their
 * relative input position (a stable sort).
 *
 * `props` is passed through by reference — callers rely on the same object so
 * they can round-trip it back into Roam on undo without a deep-clone.
 *
 * Returns null for null/undefined input or any node missing `:block/uid`.
 */
export function normalizePulledSubtree(raw) {
  if (raw == null) return null;
  if (!(":block/uid" in raw)) return null;

  const node = {
    uid: raw[":block/uid"],
    string: ":block/string" in raw ? raw[":block/string"] : "",
    order: ":block/order" in raw ? raw[":block/order"] : 0,
    props: undefined,
    open: undefined,
    heading: undefined,
    textAlign: undefined,
    children: [],
  };

  if (":block/props" in raw) node.props = raw[":block/props"];
  if (":block/open" in raw) node.open = raw[":block/open"];
  if (":block/heading" in raw) node.heading = raw[":block/heading"];
  if (":block/text-align" in raw) node.textAlign = raw[":block/text-align"];

  if (":block/children" in raw && Array.isArray(raw[":block/children"])) {
    node.children = raw[":block/children"]
      .map(normalizePulledSubtree)
      .filter((c) => c !== null)
      .sort((a, b) => a.order - b.order);
  }

  return node;
}

/**
 * Flatten a normalized tree into an ordered list of block-create steps.
 *
 * The root step uses the supplied `parentUid`; every descendant step uses its
 * own parent node's uid as `parentUid`. Steps are emitted depth-first
 * pre-order with siblings in ascending `order`.
 *
 * INVARIANT (load-bearing for undo): each step's `parentUid` is either the
 * function's `parentUid` argument or the uid of a step emitted EARLIER. The
 * caller creates blocks in array order, so a parent always exists before its
 * children are attached.
 */
export function flattenSubtreeToCreateSteps(tree, parentUid) {
  if (tree == null) return [];

  const steps = [];
  const walk = (node, parent) => {
    steps.push({ parentUid: parent, order: node.order, string: node.string, uid: node.uid });
    for (const child of node.children) walk(child, node.uid);
  };
  walk(tree, parentUid);
  return steps;
}

/**
 * Every uid in the tree, root first, depth-first pre-order.
 */
export function collectTreeUids(tree) {
  if (tree == null) return [];
  const out = [];
  const walk = (node) => {
    out.push(node.uid);
    for (const child of node.children) walk(child);
  };
  walk(tree);
  return out;
}

const TASK_MACROS = ["{{[[TODO]]}}", "{{TODO}}", "{{[[DONE]]}}", "{{DONE}}"];

function isTaskString(s) {
  if (typeof s !== "string") return false;
  return TASK_MACROS.some((m) => s.includes(m));
}

/**
 * Count nodes whose string carries a Roam TODO or DONE macro.
 *
 * Matching is case-sensitive and looks for any of the four macro forms. When
 * `options.excludeRoot` is true (the default) the root node itself is not
 * counted even if it is a task — the common case is counting task children
 * inside a container that is being deleted.
 */
export function countTaskBlocks(tree, options = {}) {
  if (tree == null) return 0;
  const excludeRoot = options == null || options.excludeRoot == null ? true : options.excludeRoot;
  let count = 0;
  const walk = (node, isRoot) => {
    if (!(isRoot && excludeRoot) && isTaskString(node.string)) count += 1;
    for (const child of node.children) walk(child, false);
  };
  walk(tree, true);
  return count;
}

/**
 * De-duplicate a set of selected root uids and drop any that are nested inside
 * a DIFFERENT selected uid's subtree.
 *
 * `uidToTreeUids` may be a Map or a plain object mapping uid → array of every
 * uid in that uid's subtree (including itself). A uid with no entry is kept
 * unless another selection's tree list contains it.
 *
 * Result preserves first-occurrence input order. Chains collapse to the
 * outermost ancestor: selecting [A, B, C] where A ⊃ B ⊃ C returns [A].
 */
export function dropNestedSelections(uids, uidToTreeUids) {
  if (!Array.isArray(uids)) return [];

  const lookup = (uid) => {
    if (uidToTreeUids instanceof Map) return uidToTreeUids.get(uid);
    if (uidToTreeUids != null) return uidToTreeUids[uid];
    return undefined;
  };

  const seen = new Set();
  const kept = [];
  for (const uid of uids) {
    if (seen.has(uid)) continue;
    seen.add(uid);

    let nested = false;
    for (const other of uids) {
      if (other === uid) continue;
      const tree = lookup(other);
      if (tree && tree.includes(uid)) {
        nested = true;
        break;
      }
    }
    if (!nested) kept.push(uid);
  }
  return kept;
}
