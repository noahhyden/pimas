# Stability

Pre-1.0, solo-maintained. Pin exact versions. `0.2.0` removed the renderer; `0.1.x` is the last framework release.

Within 0.2.x, the exports below are additive. Breaking changes bump `0.x.0`.

| Entry | Surface |
| --- | --- |
| `pimas-ui` | `createSignal` / `createEffect` / `createMemo` / `batch` / `untrack` / `onCleanup` / `createRoot` / `subscribe` / `catchError` / `setScheduler` / `flushSync` / `speculate` |
| `pimas-ui/store` | `createStore`, `reconcile`, `produce`, `onStoreWrite` |
| `pimas-ui/agent` | `createModel`, `createAgentBridge` |
| `pimas-ui/agent/webmcp` | `toWebMCP` |
| `pimas-ui/react` | `usePimas`, `useSnapshot` |

`0.1.x` renderer entries (`pimas-ui/dom`, `/flow`, `/server`, `/resume`, `/hydrate`, `/compiler`, `/resource`, `/jsx-runtime`) are gone.

Releases after `0.1.0` carry signed npm provenance.
