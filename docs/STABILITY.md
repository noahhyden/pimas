# Stability & versioning

This codifies what's already implied by the README's 🔬 markers and the changelog:
which parts of pimas you can build on today, and what a version bump is allowed to
change. It's a statement of *intent* for a pre-1.0, solo-maintained project — not a
support contract.

## Tiers

Each public entry point (subpath export) is either **Stable** or **🔬 Experimental**.

### Stable

Core reactivity and rendering. The API shape is settled; changes are additive
within a minor series, and breaking changes follow the versioning rules below.

| Entry | Surface |
| --- | --- |
| `pimas` | `createSignal`/`createEffect`/`createMemo`/`batch`/`untrack`/`onCleanup`/`createRoot`, `createContext`/`useContext`, `setScheduler`/`flushSync` |
| `pimas/dom` | `render`/`h`/`Fragment`/`onMount`, `model`/`modelChecked`/`modelNumber` |
| `pimas/server` | `renderToString` |
| `pimas/flow` | `<Show>`/`<Switch>`/`<Match>`, `<For>`, `<Index>`, `<ErrorBoundary>`/`catchError` |
| `pimas/store` | `createStore`, `reconcile`, `produce` |
| `pimas/jsx-runtime`, `pimas/jsx-dev-runtime` | the automatic JSX runtime |

### 🔬 Experimental

Useful and tested, but the API may change (or be withdrawn) in **any** release,
including a patch. Pin an exact version if you depend on one. These are the
exploratory surfaces — resumability, the agent layer, the build-time compiler, and
the async primitive.

| Entry | Surface |
| --- | --- |
| `pimas/resource` | `createResource` |
| `pimas/resume` | `resume()` client dispatcher |
| `pimas/hydrate` | `claim()` DOM adoption |
| `pimas/agent`, `pimas/agent/webmcp` | the agent-simulatable surface (L1/L2/L3, WebMCP projection) |
| `pimas/compiler` | build-time thunk-eraser plugin |

## Versioning

pimas follows [Semantic Versioning](https://semver.org/), with the usual pre-1.0
latitude:

**Pre-1.0 (`0.x`, where we are now):**
- **Patch (`0.1.x`)** — additive features and fixes. No breaking change to a
  **Stable** entry. (0.1.1 and 0.1.2 added typed JSX, `createResource`, and form
  binding this way.)
- **Minor (`0.x.0`)** — may include breaking changes to Stable entries, called out
  in the changelog.
- **Experimental** entries may break in any release, patch included.

**Post-1.0 (future):** standard semver — Stable entries break only on a **major**
bump; new features are minors; fixes are patches. Experimental entries keep their
"may change anytime" status until they graduate (which will be a changelog note and
the removal of the 🔬 marker).

## Deprecation

When a Stable API is slated to change, the intent is: ship the replacement first,
mark the old one deprecated (JSDoc `@deprecated` + a changelog note) for at least one
minor series, then remove it on the next allowed breaking bump. Experimental APIs
carry no such guarantee.

## Provenance

Releases published through CI carry a signed npm provenance attestation (built from
tagged source via GitHub Actions OIDC). `0.1.0` was a manual bootstrap and predates
this; `0.1.1`+ are attested.

## Caveats

Solo-maintained and pre-1.0: treat this as best-effort. The 🔬 layers are research
directions, not product commitments — see [`AGENT-NATIVE.md`](AGENT-NATIVE.md) and
[`DECISIONS.md`](DECISIONS.md) #41 for that framing.
