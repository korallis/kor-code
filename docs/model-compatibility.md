# Model compatibility

Kor records model checks in `~/.local/state/kor/models.json`. Set `KOR_MODEL_REGISTRY` to use another file during a probe or a local proof.

Run a probe against the live `/v1/models` catalogue:

```sh
kor models probe --dry-run
kor models probe
kor models probe --family gpt
kor models probe --model devin/gemini-3-8-flash
```

Kor selects text models from every provider. Family matching ignores route prefixes and accepts dotted or hyphenated versions. Requests retain the gateway's exact model id. Known image, video and speech generation models are excluded.

Each selected model runs one built-in prompt in a fresh sandbox HOME, config and working directory. The prompt requests a Write tool call, an independent Bash read and a final JSON object. The table reports `pass`, `fail`, or `absent` for streaming, tool calls, thinking and structured output. Routing requires streaming, tools and JSON. Thinking remains an observed capability that a route can request explicitly. A model without visible thinking can qualify for coding.

Failures print to stderr and remain in the registry's `error` field. Kor saves each completed result, so interrupting a long sweep preserves completed probes. Quota, account access and upstream tool restrictions can prevent an advertised model from passing.

List verified models that are currently advertised by the gateway:

```sh
kor models list
```

`GatewayAdapter.catalogue()` reads the same registry and filters the live catalogue to verified models. Explicit `modelCapabilities` supplied by an adapter caller remain routable for fixtures and one-off proofs. An empty registry leaves live models unroutable until a probe records them.

`kor models list`, planning and routing intersect saved probe results with a fresh live catalogue. Missing models keep their probe history and become eligible again when the gateway advertises them. Mission Control refreshes models every minute, marks verified models and offers them in the default-model picker. Saving a selection also saves its catalogue provider. The CLI records `owned_by` as the provider rather than treating a route prefix such as `devin/` as the model vendor.

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
