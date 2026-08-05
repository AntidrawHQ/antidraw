# SDK behaviour checks

Two standalone harnesses that pin down `@anthropic-ai/claude-agent-sdk`
behaviour the stream lifecycle in `packages/shell/src/main` depends on.

They import **nothing** from antidraw — they drive the SDK directly and
hand-roll their own copy of `buildPrompt`. Whatever they report is evidence
about the SDK and CLI, not about our wrapper. Run them after an SDK bump to
catch a change in these assumptions.

Both make **real API calls** (a couple of short turns each) and need working
CLI auth.

```bash
node scripts/sdk-checks/verify-interrupt.mjs
node scripts/sdk-checks/verify-deadproc.mjs
```

## verify-interrupt.mjs

Establishes what `query.interrupt()` actually does.

| | Claim | Result when last run |
|---|---|---|
| C1 | interrupt aborts the in-flight turn | pass |
| C2 | the CLI process **survives** interrupt | pass — pid still running |
| C3 | the message iterator does **not** terminate | pass — still open 6s later |
| C4 | the session stays usable | pass — next turn answered on the same session id |
| C5 | closing the input stream is what ends it | pass — iterator closed 1s after `end()` |

C2 ∧ C3 is why `cancelStream` only interrupts and does not delete its registry
entry. Deleting it there strands a live process behind a loop that can never
exit, because nothing closes its input stream and its `finally` never runs.

## verify-deadproc.mjs

Measures how fast a dead CLI propagates to the message iterator — i.e. whether
the loop's own `finally` cleans up fast enough without help.

| Kill | Iterator | Meaning |
|---|---|---|
| `SIGKILL` (process dies) | throws in **~0.01s** | self-cleans; no explicit drop needed |
| `SIGSTOP` (process wedged) | **still open after 60s** | never self-cleans |

The abrupt-death result is why `PUT /chat/:conversationId/options` no longer
drops the stream when a live option apply fails: a genuinely dead process is
gone from the map within ~10ms anyway.

A wedged CLI stays unhandled. Note that the SDK gives control requests **no
timeout** — the promise is parked in `pendingControlResponses` and settled only
by a matching response or by transport close — so against a frozen process
`setModel()` never settles and that catch is never reached at all. The right
detector is a timeout on the send path ("pushed a turn, got nothing back"),
which covers every cause rather than only the users who happen to open the
model picker mid-hang.

Both scripts also confirm that `push()` after the process dies returns
`enqueued (no error)`: enqueuing into a `ReadableStream` with no consumer is
silent, so a stale registry entry eats the user's next message without
surfacing anything.
