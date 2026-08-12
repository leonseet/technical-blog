# Python Standards

## Scope

- `**/*.py`

## Typing

- **Do not use `Any` for known contracts.** Prefer the concrete type exported by the dependency or internal module. If the dependency does not expose a usable type, keep the untyped interaction inside a small boundary adapter and return a typed project-owned value from that adapter.
- **Treat `Any` as an explicit escape hatch.** Only use it when the value is genuinely untyped/dynamic and the alternatives above would be misleading; keep the scope local and document why the escape hatch is necessary.
- **Inline short local union types.** Do not introduce private aliases just to hide a small union used in one module. Reserve `TypeAlias` for shared domain vocabulary, long repeated types, or names that materially clarify intent.
  - ✗ `_BoxTensor: TypeAlias = Tensor | NDArray[np.floating]`
  - ✓ `def _as_numpy(value: Tensor | NDArray[np.floating]) -> NDArray[np.floating]: ...`

## Errors & control flow

- **Do not use `getattr` for known object contracts.** If a dependency or internal object has a documented shape, access attributes directly so drift fails loudly at the contract boundary.
  - ✗ `boxes = getattr(result, "boxes", None)`
  - ✓ `boxes = result.boxes`
- **Reserve `getattr` for genuinely dynamic or optional capability probing.** When used, add a short comment explaining why direct attribute access is not appropriate.

## Styling

- **Use f-strings for string interpolation, including log messages.** Interpolate values directly; do not use `%`-style args, `str.format`, or string concatenation.
  - ✗ `log.info("detect: found %d person(s)", total)`
  - ✓ `log.info(f"detect: found {total} person(s)")`

## Logging

- **Get loggers via the project helper, not `logging.getLogger` directly.** Call `get_logger(__name__)` from `agentic_reid.helpers.loggers` so every module shares the `agentic_reid.*` namespace and the single configured handler.
- **Only application entry points configure logging.** Call `configure_logging(...)` exactly once per process (CLI callback, worker/API bootstrap). Library modules must never configure handlers or levels.

## Dependencies & runtime

- **Target Python `>=3.12`.** Set `requires-python = ">=3.12"` and keep tool targets (`tool.ruff.target-version`, `pyright`) aligned.
- **Pin to the latest stable release of every dependency.** When adding or touching a dependency, check its newest published version (e.g. PyPI) and set the lower bound to that minor (`pydantic>=2.13,<3`), capped below the next major.
