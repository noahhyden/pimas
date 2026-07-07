# Direction spike — the agent-simulatable frontend

> Status: **exploration**, not a committed pivot. This records a thesis and a
> staged plan to validate it in code. It supersedes nothing yet; the framework
> (Phases 1–5) stands as-is. See [`DECISIONS.md`](DECISIONS.md) #41.

## Why this, and why now

Building a general-purpose React replacement is not viable for a solo maintainer
— React is maintained by thousands; pimas by one, and as a *UI framework* it dies
with the author's portfolio site. So the question is not "how do we compete with
React" but **"what can a from-scratch fine-grained reactive engine do that nobody
else can, that is worth owning as a small, sharp thing?"**

The answer we landed on reframes the project: **pimas-the-framework stops being
the product and becomes the lab.** The product-shaped idea is a niche in
*frontend-for-agents* that the incumbents structurally cannot reach — because
their substrate (a virtual DOM, or scraping the accessibility tree) doesn't carry
the information the idea needs, and pimas's does.

## The niche: a UI an agent can *simulate before it acts*

Every existing way an agent touches a web UI is **request/response or scrape**:

| Occupied cell (mid-2026) | Who | What it does |
| --- | --- | --- |
| UI→agent **actions** | WebMCP (`document.modelContext.registerTool`, Chrome origin trial, Gemini), CopilotKit `useCopilotAction` | Page declares callable tools the agent invokes |
| **agent→UI** events / generative UI | AG-UI, mcp-ui / MCP Apps, Vercel AI SDK, assistant-ui | Agent streams UI/events into a chat surface |
| a11y-tree **scraping** | computer-use, Playwright MCP, browser-use | Agent reads a DOM/aria snapshot, clicks by ref |

All of them let the agent *poke the surface and then look again to see what
changed*. None of them expose the thing a fine-grained reactive engine already
maintains as first-class runtime state: **the live dependency graph** — what is
readable (signals/memos), what changes it (setters/handlers), how values derive
(the sources/observers DAG), and *when* they change (the subscription graph).

That opens a cell nobody occupies. Three layers, foundation → wedge:

- **L1 — subscribe.** The agent subscribes to a specific piece of live UI state
  and is *pushed* the delta on change — no DOM polling, no re-scraping. An
  agent-side `createEffect(() => notify(total()))` already *is* this subscription.
  *(Novelty: partial — AG-UI/CopilotKit/MCP do coarse or prompt-snapshot versions.
  This is the substrate, not the headline.)*
- **L2 — explain.** Because the engine tracks a dependency DAG, it can tell the
  agent *why* a value changed: "`total` changed because action `addItem` set
  `cart[3].qty`, which the `total` memo reads." Human-facing versions of this
  exist (Redux DevTools, MobX `trace`, React Scan); **exposing a reactive causal
  chain to an agent is unclaimed.**
- **L3 — simulate (the wedge).** The agent proposes hypothetical writes; the
  framework computes the resulting derived state in a **shadow graph — without
  committing to the DOM or firing side-effecting effects** — and returns the
  predicted next state. The agent can *plan* multi-step interactions by
  simulating them first. **Genuinely open.** Distinct from:
  - *agent world-models* (learned / video-diffusion rollouts) — those are
    **approximate**; L3 re-runs the app's own pure memos, so it's **exact/ground-truth**.
  - *optimistic updates / MST snapshots* — those are **commit-then-rollback** for
    UX latency, driven by the app; L3 is **pre-compute-without-committing**,
    queried by the agent for planning.

**Thesis in one line:** *the UI as a live, causally-traceable, deterministically
simulatable model an agent can subscribe to, explain, and plan against* — instead
of a surface it pokes and re-scrapes. L1 is the floor; **L2 + L3 are the parts no
one has, and they're only cheap on a fine-grained reactive graph.**

## Why pimas specifically can do L3 (and a VDOM can't)

The engine is **pull-based, and topology is separate from value** (see
[`src/reactive/reactive.ts`](../src/reactive/reactive.ts)): memos compute lazily on
read via `updateIfNecessary`; the dependency DAG (`sources`/`observers`) is
structure, held apart from the cached `value`/`state` (3-color) on each node. That
is exactly what makes a hypothetical evaluable:

- You can **shadow just the values and colors** — a `speculationLayer:
  Map<Reactive, value>` + a parallel shadow cache — and **reuse the real DAG
  read-only**. Propagation doesn't change; you only override *where a read's value
  comes from*.
- Effects (the side-effecting, DOM-touching roots) are simply **not flushed** in
  speculation mode, so nothing commits.
- **Rollback is free**: discard the maps. Real `node.value`/`node.state` were
  never touched.

The naive "set the signal, read the memo, set it back" trick does **not** work —
`writeNode` mutates `value` in place and the pull overwrites the memo's real cache;
restoring doesn't reliably rewind the 3-color state. The shadow overlay is the
minimal correct mechanism. A VDOM framework has no standing dependency graph to
shadow — it would have to re-render and diff, with no guarantee the result is
side-effect-free.

## The one honest risk

The whole edifice assumes **memos are pure**. The core assumes this but does not
enforce it. L3 is only correct for pure memos; an impure memo (closing over
external mutable state, or a `setStore` mid-speculation) can leak real effects.
Mitigation, not elimination: copy-on-write for the store in speculation mode,
forbid/no-op effects during a speculation, and warn on writes that escape the
shadow. Design around it; don't pretend it's solved.

## Staged plan — status (live tracker: issue #13)

- ✅ **L1** — `pimas/agent` `createAgentBridge` (expose/subscribe/call, push-on-change, zero core change).
- ✅ **L3** — `speculate(apply, read)` in the core (shadow read/write, effects don't fire, free
  rollback), **plus store copy-on-write** (`speculationScratch` on the core) so hypothetical
  *edits* work. Hot-path floor 679→698 gz; heavy logic tree-shakes. **+ the planning half** (D#51):
  bridge `speculatePlan(steps)` composes a multi-factor scenario in one shadow, `speculateSweep(name,
  argsList)` runs a sensitivity sweep — both zero core change, on the quantitative-model axis.
- ✅ **L2** — `pimas/store` `onStoreWrite` + a bridge `CauseRecord` (`explain()` / `cause` event).
- ✅ **WebMCP** — `pimas/agent/webmcp` `toWebMCP(bridge)` (actions→tools, state→`get_*` tools,
  `document.modelContext`, AbortSignal teardown, MCP content envelope). **+ L3 now projected**
  (commit dcb2672): each mutating action → a read-only `simulate_<name>` tool (→ `speculate`,
  predicts without committing), plus `simulate_plan` (→ `speculatePlan`) and `simulate_sweep`
  (→ `speculateSweep`). `simulateTools:false` gives a poke-and-rescrape baseline — the A/B switch
  for the eval below. This closes the gap that made the claim untestable: until now a real MCP/WebMCP
  agent got L1 reads + mutating actions but NOT the what-if wedge.
- ✅ **Validated** — 101 vitest green; the klarum showcase model; and end-to-end on a **real HTTP
  stack** (pivi `/api/proposals`): a browser **preview → approve → commit** copilot
  (`Klarum-Software/pivi` worktree `spike/pimas-agent-records`, `agent-native/`) — `speculate`
  previews the exact totals, approve fires a real `PATCH`, the backend persists.
- ✅ **Validated again, on a quantitative model** — `noahhyden/von-neumann` `wall-live/`: a live
  rebuild of the `closure-sim` self-replicating-lunar-factory explainer, run in a pimas graph
  (bill-of-materials = `createStore` COW, params = signals, results = memos). The "electronics
  wall" analysis — which the Python does by deep-copy → toggle → re-run → diff → discard — becomes
  a first-class `speculate`: exact after-state against a shadow graph, nothing committed, and the
  bridge's `explain()` names the field-level cause. The core computes the model **and** renders the
  page (~11 KB gz), and the TS math is pinned to the reference Python by a cross-language
  differential test (60 random factories / 540 fields).
- ✅ **Validated a 2nd time, on a structurally different model** — `composite-ind` `frontend/`: an
  OECD/JRC composite-indicator index (8 countries × 3 pillars × 9 indicators) run in a pimas graph
  (indicator table = `createStore` COW, method/pillar-weight inputs = signals, ranking = memos). Its
  native **sensitivity/uncertainty** activity — which `analysis.py` computes with a hand-rolled
  `build(model_copy(update=…))` loop — becomes a first-class **`speculateSweep`** (a pillar-weight
  sweep, proven == N independent builds), with multi-factor scenarios as **`speculatePlan`** and
  approve→apply as **`commitPlan`** (one coalesced L2 record). TS math pinned to Python by a
  differential test (6254 field comparisons); the whole page is a browser-verified interactive
  what-if (8.3 KB gz). This is the **first consumer of the D#51/#52 plan/sweep/commit surface**, and —
  a cross-sectional normalise→rank pipeline vs. wall-live's time-stepped sim — the **N=2 data point**
  that de-risks a future reusable "model→pimas graph" helper (D#51's stated gate).

- ✅ **The claim itself, first tested (2026-07-03)** — every proof above validated the *mechanism*
  (parity, `speculateSweep == N builds`); none put a real agent in the loop. `sector-engines`
  `engines/composite_ind/frontend/eval/spike.mjs` drives the composite-index model through the **real
  projected WebMCP tools** under two conditions with an identical grid-search policy: **A** (baseline:
  actions + `get_*` only, `simulateTools:false` — must commit each probe to observe it) vs **B**
  (adds `simulate_sweep`). Same answers, same correctness, structurally different footprint:
  France→#2 (solvable) A=55 calls/37 commits/**27 wrong live states**, B=4/1/**0**; Germany→#1
  (impossible) A=54/36/**36**, B=3/0/**0**. "Impossible" is where simulate wins hardest (baseline
  must probe the whole space to be sure). The spike also caught + fixed two real bugs a live agent
  would hit (`params`-as-objects in the frontend; void-action envelope → `text:undefined` in pimas,
  9af924e). It proves ergonomics + the wedge; the metric-grade LLM benchmark (5 tasks, Gemini/Haiku,
  instrumented) is designed in `eval/README.md`, not yet built.

**Sharpened framing (2026-07-01).** L3 is at its sharpest not on generic app state but on **pure,
derived-heavy quantitative models** — finance/economics/engineering pipelines where hypothetical
"what-if" is the whole activity and the fatal purity caveat is *free* (these models are already pure
functions of their inputs). The defensible product-shaped framing is therefore **"an exact reactive
what-if + provenance engine for quantitative models"** — proven by `wall-live`, and generalizes to
input→derived-output model repos whose hand-rolled `model_copy(update=…)` sweeps are a weaker
reimplementation of `speculate`.

- **Open forks** (need a human call): the same treatment on an econ-model repo (road-econ /
  fiscal-incidence) or a small reusable "quantitative model → pimas graph" helper; a React adapter
  for pivi's real Next frontend; wiring the real Neon-backed gateway (needs creds — pivi's gateway
  can't boot from scratch: prod-cutover Alembic + `proposals` is raw-SQL/migration-only); P0
  hardening of `pimas/agent` (error isolation, async actions, delta coalescing).

## What this reframe changes about the roadmap

- The **compiler** ([#12](../../../issues/12)) is a *UI-rendering* optimization —
  near-zero value to an agent surface. It stays parked; this pivot likely
  supersedes the reason to ever build it.
- **Byte-golfing** and the DOM reconciler matter only insofar as pimas stays a
  human-facing UI framework (the lab). They are not the differentiator here.
- The **crown jewel** is the auto-subscribing reactive graph + the
  `HandlerDescriptor {ref, load, capture}` seam. Everything the pivot needs hangs
  off those.
