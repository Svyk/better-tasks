# Querying Better Tasks — Cookbook

Better Tasks stores everything as native Roam blocks, which means every native
query surface in Roam can see your tasks. This cookbook covers the three ways
to query them, from easiest to most powerful:

1. **`{{bt-query}}`** — an interactive task list with a simple syntax (no
   Datalog needed)
2. **Native `{{query}}`** — Roam's built-in query component
3. **`:q` Datalog blocks** — full power, copy-paste snippets below

## How tasks are stored (30-second recap)

```
{{[[TODO]]}} Prepare launch checklist
  BT_attrDue:: [[July 18th, 2026]]
  BT_attrProject:: [[Website Refresh]]
  BT_attrWaitingFor:: [[Alex]]
  BT_attrContext:: [[Deep Work]]
```

Two facts drive everything below:

- The **task block** references the `TODO` (or `DONE`) page.
- Each piece of metadata lives in a **child block** that references the
  attribute page (`BT_attrDue`, `BT_attrProject`, …) **and** the value page.
  Dates were always `[[page refs]]`; project, waiting-for and context values
  are written as `[[page refs]]` too since the *page-ref consistency* release
  (setting: **Write Project/Waiting/Context as page links**). Tasks last
  edited before that release may still hold plain-text values — re-saving the
  attribute (or just editing it once) upgrades it.

> All snippets use the default attribute names (`BT_attr*`). If you renamed
> attributes in settings, substitute your names.

---

## 1. `{{bt-query}}` — the easy way

Type this in any block:

```
{{bt-query: status="TODO" due="this-week"}}
```

Better Tasks replaces Roam's plain button with a live task list: native
checkboxes (completing spawns the next occurrence of recurring tasks), inline
pills, a result count, and a refresh button.

### Syntax

`{{bt-query}}` alone shows your 20 most relevant open tasks. Add
space-separated `key="value"` filters:

| Key | Values | Example |
|-----|--------|---------|
| `status` | `TODO` (default), `DONE`, `all` | `status="DONE"` |
| `project` | project name (brackets optional) | `project="Website Refresh"` or `project=[[Website Refresh]]` |
| `due` | `overdue`, `today`, `upcoming`, `this-week`, `none`, `YYYY-MM-DD`, `YYYY-MM-DD..YYYY-MM-DD` | `due="overdue"` |
| `completed` | `today`, `this-week`, `last-24-hours`, `last-7-days`, ISO date or range | `completed="last-7-days"` |
| `blocked` | `blocked`, `actionable` | `blocked="actionable"` |
| `assignee` | free text | `assignee="Sam"` |
| `query` | free-text search across title and metadata | `query="quarterly report"` |
| `limit` | 1–200 (default 20) | `limit=50` |
| `sort` | `due` (earliest first, undated last) | `sort="due"` |

Values with spaces need quotes (single or double) — except bare
`[[Page Title]]` refs, which are read to the matching brackets. Unknown keys
and malformed values render an inline error naming the problem, so typos
never silently return wrong results.

### Examples

```
{{bt-query: due="overdue"}}
{{bt-query: project=[[Website Refresh]] sort="due"}}
{{bt-query: blocked="actionable" due="this-week" limit=10}}
{{bt-query: status="DONE" completed="last-7-days"}}
{{bt-query: query="review" due="2026-08-01..2026-08-31"}}
```

Notes:

- Results come from the same engine as the dashboard and the `bt_search`
  Extension Tools API; the list live-updates as tasks change on the page, and
  the ↻ button forces a fresh read (useful for edits made in another tab —
  Roam's cross-tab sync can lag ~30 seconds).
- The component is a *view* of the block's text. Edit the block to change the
  filters; delete the block and the component goes with it. Turning off the
  **{{bt-query}} task lists** setting restores Roam's plain button everywhere.

---

## 2. Native `{{query}}`

Because attribute values are page refs, Roam's native query component
discovers Better Tasks with no extension involvement:

```
{{[[query]]: {and: [[TODO]] [[Website Refresh]] [[BT_attrProject]]}}}
```

**How to read the results:** Roam's native queries match a block when the
conditions hit the block *or its ancestors*. The block that satisfies all
three conditions here is the **attribute child** (`BT_attrProject::
[[Website Refresh]]`, whose parent task references `TODO`) — so results show
the attribute rows, with the task visible in each result's breadcrumb/parent
context. Including `[[BT_attrProject]]` narrows matches to genuine Better
Tasks metadata rather than any block that happens to mention the project.

This is native Roam behaviour with native pros (works everywhere, saved
queries, no learning curve if you already use queries) and cons (attribute
rows instead of task rows). When you want task rows with checkboxes and
pills, use `{{bt-query}}` instead.

More native examples:

```
{{[[query]]: {and: [[TODO]] [[Alex]] [[BT_attrWaitingFor]]}}}
{{[[query]]: {and: [[TODO]] [[BT_attrDue]] [[July 18th, 2026]]}}}
{{[[query]]: {and: [[DONE]] [[Website Refresh]] [[BT_attrProject]]}}}
```

---

## 3. `:q` Datalog snippets

Roam's `:q` blocks accept Datalog plus Roam-specific additions — `dnp/`
symbols (`dnp/today`, `dnp/this-week-start`), `ms/` time symbols
(`ms/today-start`, `ms/-14D-start`) and built-in rules like
`(refs-page ?title ?b)` and `(refs-dnp-between ?start ?end ?b)`. These
additions are documented at
<https://roamdocs.fyi/help/roam-specific-q-additions.md> (they are not in the
core Datascript docs). Type each snippet into a block starting with `:q`.

> **Verify in your graph first.** The `dnp/` and `ms/` symbols are Roam
> features that evolve; if a snippet returns nothing, check the roamdocs page
> for the current symbol names.

### Tasks in a project (task rows, not attribute rows)

```
:q [:find (pull ?task [:block/uid :block/string])
    :where
    (refs-page "TODO" ?task)
    [?task :block/children ?child]
    (refs-page "BT_attrProject" ?child)
    (refs-page "Website Refresh" ?child)]
```

The explicit child→parent join is what native `{{query}}` can't express —
you get the **task block** itself.

### Overdue (due on or before today)

```
:q [:find (pull ?task [:block/uid :block/string])
    :where
    (refs-page "TODO" ?task)
    [?task :block/children ?child]
    (refs-page "BT_attrDue" ?child)
    (refs-dnp-between "January 1st, 2020" dnp/today ?child)]
```

The window includes tasks due *today*; Better Tasks itself treats those as
"due today", not overdue. Tighten the start date to taste.

### Due this week

```
:q [:find (pull ?task [:block/uid :block/string])
    :where
    (refs-page "TODO" ?task)
    [?task :block/children ?child]
    (refs-page "BT_attrDue" ?child)
    (refs-dnp-between dnp/this-week-start dnp/this-week-end ?child)]
```

Respects Roam's week-start; Better Tasks has its own first-day-of-week
setting for its UI, so the two can differ by design.

### Waiting on a person

```
:q [:find (pull ?task [:block/uid :block/string])
    :where
    (refs-page "TODO" ?task)
    [?task :block/children ?child]
    (refs-page "BT_attrWaitingFor" ?child)
    (refs-page "Alex" ?child)]
```

### Stalled-ish: open tasks created more than 14 days ago

```
:q [:find (pull ?task [:block/uid :block/string])
    :where
    (refs-page "TODO" ?task)
    [?task :block/children ?child]
    (refs-page "BT_attrDue" ?child)
    (created-between ms/-365D-start ms/-14D-start ?task)]
```

This approximates by *creation* time. The dashboard's Stalled filter uses
*last edit* time (`:edit/time`), which Datalog can also reach — but the
dashboard filter (or `{{bt-query}}` + the Stalled chip) is the more accurate
tool for this job.

### Completed in a project (audit trail)

```
:q [:find (pull ?task [:block/uid :block/string])
    :where
    (refs-page "DONE" ?task)
    [?task :block/children ?child]
    (refs-page "BT_attrProject" ?child)
    (refs-page "Website Refresh" ?child)]
```

---

## Appendix: `roam/render` + the Extension Tools API (power users)

Better Tasks exposes `bt_search` (and 15 other tools) on
`window.RoamExtensionTools["better-tasks"]` — see the README's Extension
Tools API section for the full argument reference. The registry entry has a
`tools` array; each tool carries an async `execute(args)`.

Try it in the browser console first:

```js
const bt = window.RoamExtensionTools["better-tasks"];
const search = bt.tools.find((t) => t.name === "bt_search");
const result = await search.execute({ due: "overdue", max_results: 10 });
console.log(result.tasks.map((t) => t.text));
```

A `roam/render` component can do the same (sketch — adapt to your setup):

```clojure
(defn bt-overdue []
  (let [results (r/atom nil)]
    (fn []
      (when (nil? @results)
        (let [bt   (aget (.-RoamExtensionTools js/window) "better-tasks")
              tool (->> (array-seq (.-tools bt))
                        (filter #(= (.-name %) "bt_search"))
                        first)]
          (-> (.execute tool (clj->js {:due "overdue" :max_results 10}))
              (.then #(reset! results (js->clj % :keywordize-keys true))))))
      [:div
       (for [task (:tasks @results)]
         ^{:key (:uid task)} [:div (:text task)])])))
```

Caveats, and why `{{bt-query}}` is the supported path instead: `roam/render`
is gated behind a Roam setting ("custom components"), the component lives as
user-editable code in your graph, and invoking it embeds a graph-specific
block uid. Verify the console snippet works in your graph before wiring the
component. Use this route when you want a custom rendering `{{bt-query}}`
can't do.

---

*Part of Phase 10 (Ecosystem & Insights). See also: README → "Querying
Better Tasks", the dashboard's saved views, and the `bt_search` /
`bt_export` Extension Tools.*
