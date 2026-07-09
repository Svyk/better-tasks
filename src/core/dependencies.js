// Pure task-dependency graph logic for Better Tasks.
//
// Extracted from src/index.js so it can be unit-tested in Node. The graph is
// reached through injected accessors, so this module knows nothing about Roam:
//
//   getDeps(uid)  -> Promise<string[] | null>   null = block no longer exists
//   getTask(uid)  -> Promise<{ completed: boolean, title: string } | null>
//
// Caching lives in the caller (index.js), deliberately: a cached cycle verdict
// for (X → Y) depends on the entire transitive subgraph beneath Y, not just on
// X and Y, so only the caller knows when it is safe to keep one.

/**
 * Node budget for a single traversal.
 *
 * This used to be 20 and was called `maxDepth`, but it has always counted
 * *nodes expanded*, not depth. That made a shallow-but-wide graph defeat it:
 * a task with 25 direct dependencies, one of which pointed back at the task,
 * hid a depth-2 cycle. Real dependency graphs are small and every lookup is
 * cached, so the budget is now high enough that `truncated` should never fire
 * in practice — and when it does, the caller is told rather than being handed
 * a confident "no cycle".
 */
export const DEFAULT_MAX_NODES = 500;

/** `((uid)), ((uid))` → `["uid", "uid"]`. Roam uids are [A-Za-z0-9_-]. */
export function parseDependsValue(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((token) => token.trim())
    .map((token) => {
      const m = token.match(/^\(\(([a-zA-Z0-9_-]+)\)\)$/);
      return m ? m[1] : null;
    })
    .filter(Boolean);
}

/** `["a", "b"]` → `"((a)), ((b))"`. */
export function formatDependsValue(uids) {
  if (!Array.isArray(uids)) return "";
  return uids.map((uid) => `((${uid}))`).join(", ");
}

/**
 * Is `targetUid` reachable from `startUid` by following dependency edges?
 *
 * Iterative DFS. Missing blocks are dead ends, not errors. Returns
 * `truncated: true` when the node budget ran out before the search completed —
 * in that case `found: false` means "don't know", not "no".
 *
 * @returns {Promise<{found: boolean, truncated: boolean, visited: number}>}
 */
export async function findPath(startUid, targetUid, getDeps, options = {}) {
  const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : DEFAULT_MAX_NODES;
  const visited = new Set();
  const stack = [startUid];
  let expanded = 0;

  while (stack.length) {
    if (expanded >= maxNodes) return { found: false, truncated: true, visited: visited.size };
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    expanded += 1;

    const deps = await getDeps(current);
    if (!deps) continue; // deleted block — dead end
    for (const dep of deps) {
      if (dep === targetUid) return { found: true, truncated: false, visited: visited.size };
      if (!visited.has(dep)) stack.push(dep);
    }
  }
  return { found: false, truncated: false, visited: visited.size };
}

/**
 * Would making `taskUid` depend on `newDepUid` close a cycle?
 *
 * True when `newDepUid` already has a path back to `taskUid` (or is `taskUid`).
 *
 * @returns {Promise<{cycle: boolean, truncated: boolean}>}
 */
export async function wouldCreateCycle(taskUid, newDepUid, getDeps, options = {}) {
  if (taskUid === newDepUid) return { cycle: true, truncated: false };
  const { found, truncated } = await findPath(newDepUid, taskUid, getDeps, options);
  return { cycle: found, truncated };
}

/**
 * Which of `dependsUids` still block `taskUid`?
 *
 * A dependency stops blocking when it is completed, when its block has been
 * deleted (reported as stale so the caller can prune it), or when it sits in a
 * cycle with `taskUid` — otherwise a ring of tasks would deadlock, each
 * waiting on the next.
 *
 * @returns {Promise<{blocked: boolean, blockedBy: {uid: string, title: string}[], staleUids: string[], truncated: boolean}>}
 */
export async function computeBlockedState(dependsUids, taskUid, accessors = {}) {
  if (!Array.isArray(dependsUids) || !dependsUids.length) {
    return { blocked: false, blockedBy: [], staleUids: [], truncated: false };
  }
  const { getTask, getDeps, maxNodes } = accessors;
  const blockedBy = [];
  const staleUids = [];
  let truncated = false;

  for (const uid of dependsUids) {
    const task = await getTask(uid);
    if (!task) { staleUids.push(uid); continue; } // deleted dependency = no longer blocking
    if (task.completed) continue;
    if (taskUid) {
      const verdict = await wouldCreateCycle(taskUid, uid, getDeps, { maxNodes });
      if (verdict.truncated) truncated = true;
      // A cyclic dependency must not block, or the whole ring deadlocks.
      if (verdict.cycle) continue;
    }
    blockedBy.push({ uid, title: task.title });
  }
  return { blocked: blockedBy.length > 0, blockedBy, staleUids, truncated };
}
