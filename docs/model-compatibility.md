# Model compatibility

Kor records model checks in `~/.local/state/kor/models.json`. Set `KOR_MODEL_REGISTRY` to use another file during a probe or a local proof.

The daemon automatically verifies a small default set on first start. Jev chooses
one strong and one cheap coding model per available text-model family from the
live `/v1/models` catalogue; a family with only one model shares that choice.
Home and Models show selection, the current probe, completed count and budget.
No manual probe is required before submitting work: the home box persists a
request that needs a model and resumes it when the first model verifies. A browser
reload restores the latest waiting request in that tab; daemon restarts retain
the queue. **Verify models now** retries immediately within the same budget.
If the gateway catalogue itself is unavailable, the reply says so separately.

Automatic verification reserves $0.10 per session before launch and passes that
limit to Claude Code's `--max-budget-usd`. The persisted reservation budget is
$2 per UTC day; unsuccessful and interrupted probes keep their reservation.
Manual per-model probes are explicit calls outside that automatic budget. Jev
selection calls are separate from the gateway session budget. The daemon checks
for catalogue changes every minute, refreshes its selected probes after seven
days and cools down failed probes for 24 hours. The selection and budget live in
`~/.local/state/kor/model-verification.json`; waiting work lives in
`pending-intake.json` beside it. An unreadable budget pauses verification rather
than resetting the cap. An exhausted budget resumes after midnight UTC.

`kor doctor` exits with a failure and a concrete fix when zero models are verified.
Queued runs also wait before claiming an execution until a model is verified.

To run an explicit probe against the live catalogue:

```sh
kor models probe --dry-run
kor models probe
kor models probe --family gpt
kor models probe --model gpt-6.1-sol
```

Kor selects text models from every provider. Family matching ignores route prefixes and accepts dotted or hyphenated versions. Requests retain the gateway's exact model id. Known image, video and speech generation models are excluded.

Each selected model runs one built-in prompt in a fresh sandbox HOME, config and working directory. The prompt requests a Write tool call, an independent Bash read and a final JSON object. The table reports `pass`, `fail`, or `absent` for streaming, tool calls, thinking and structured output. Routing requires streaming, tools and JSON. Thinking is recorded as `pass` only when a thinking block is observed. Without one it is `absent` (unknown), never `fail`: this neutral prompt cannot disprove thinking support. Older saved `thinking: false` observations are also read as unknown. A route can request positively observed thinking explicitly. A model without visible thinking can qualify for coding.

Ticket routing also requires a maintained reasoning profile for the exact model
identity in `packages/jev/src/routing.ts`. Capability probes establish compatibility,
not reasoning quality. If every verified model is unprofiled, dispatch blocks
instead of guessing a model's role from its name. Select and verify one of the
profiled models, or have a maintainer add a profile for the exact gateway ID with
its class, strengths, exclusions and cost/speed policy. Profiles cannot currently
be supplied through configuration. Jev fallbacks prefer the verified, profiled
configured default; only an ineligible default needs a conservative replacement.
Configured reasoning effort remains unchanged.

Failures print to stderr and remain in the registry's `error` field. Kor saves each completed result, so interrupting a long sweep preserves completed probes. Quota, account access and upstream tool restrictions can prevent an advertised model from passing.

List verified models that are currently advertised by the gateway:

```sh
kor models list
```

`GatewayAdapter.catalogue()` reads the same registry and filters the live catalogue to verified models. Explicit `modelCapabilities` supplied by an adapter caller remain routable for fixtures and one-off proofs. An empty registry leaves live models unroutable until a probe records them.

`kor models list`, planning and routing intersect saved probe results with a fresh live catalogue. If the catalogue cannot be fetched, they retain the saved verified registry as candidates; `kor models list` warns on stderr. A successful empty catalogue still offers no models. Missing models keep their probe history and become eligible again when the gateway advertises them. Mission Control refreshes models every minute, marks verified models and offers them in the default-model picker. Saving a selection also saves its catalogue provider. The CLI records `owned_by` as the provider rather than treating a route prefix such as `devin/` as the model vendor.

To keep the registry separate, run:

```sh
KOR_MODEL_REGISTRY=/tmp/kor-probe-models.json kor models probe
KOR_MODEL_REGISTRY=/tmp/kor-probe-models.json kor models list
```

For a fully disposable CLI environment, load credentials from your runtime file and use temporary XDG directories. This Bash example does not copy credentials to the temporary HOME:

```bash
set -a
source "$HOME/.config/kor/gateway.env"
set +a
probe_root=$(mktemp -d /tmp/kor-models.XXXXXX)
(
	export HOME="$probe_root/home"
	export XDG_CONFIG_HOME="$probe_root/config"
	export XDG_STATE_HOME="$probe_root/state"
	export XDG_DATA_HOME="$probe_root/data"
	mkdir -p "$HOME" "$probe_root/work"
	cd "$probe_root/work"
	kor models probe
	kor models list
)
# Inspect $probe_root/state/kor/models.json before removing $probe_root.
```

The [2026-10-15 live probe report](model-probe-results-2026-10-15.md) records the initial catalogue, each model's outcome and upstream failures. Results are observations of account availability at that time, not permanent support guarantees.
