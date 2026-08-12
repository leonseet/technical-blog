# Testing Standards

## Scope

- `tests/**`
- `**/*_test.py`
- `**/*.test.ts`

## Tiers

Three tiers, defined by what a test *needs* — not by what it covers:

- **unit** (unmarked, the default): fakes at external seams, real filesystem (`tmp_path`), tiny media, no live services, no model weights, CPU-only. The bulk of the suite.
- **`integration`** (pytest marker): needs a live compose-stack service (Postgres, Milvus, S3, Langfuse).
- **`model`** (pytest marker): needs real weights under `.models/` and real inference. CPU-only — this tier must never require CUDA.

A test needing both a live service and real weights carries both markers. There is no separate e2e tier: a hermetic end-to-end pipeline test is just a unit-tier test.


## Mocking rules

1. **Fake at the single external seam only** (`_load_*`, `build_*_client`); everything inboard of the seam — batching, conversions, normalization math, selection policy, pagination, error discrimination — runs real.
2. **Assert outcomes, not conversations:** end state or recorded inputs; never `assert_called_with` echoes, exact call sequences, or kwarg-pinning against your own stub. Litmus: a correct rewrite of the implementation must not fail the test.
3. **Cheap real things stay real:** real `tmp_path`, real subprocesses, tiny real videos, real pydantic models. Fakes are for the expensive, the external, and the pathological.

Do not drift-proof fakes with Protocols/ABC conformance checks — real-client signature drift is an accepted risk, caught by the `integration` tier exercising real clients.

## Infrastructure-dependent tests

- **Tests that require a connection to an external service must fail when the service is unreachable** — they do not skip and are not best-effort. A hard failure halts the worktree and surfaces the infra problem for a human to fix, instead of hiding it behind a green run.
- **Never reroute a live test to fake a pass** (e.g. writing into a shared/configured bucket because an ephemeral one is unwritable, or guessing/brute-forcing credentials). A test that no longer exercises the real isolated path is worse than an honest failure.
