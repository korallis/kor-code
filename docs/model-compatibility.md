# Model compatibility

Kor records model checks in `~/.local/state/kor/models.json`. Set `KOR_MODEL_REGISTRY` to use another file during a probe or a local proof.

Run a probe against the live `/v1/models` catalogue:

```sh
pnpm kor models probe --family claude
```

Each selected model runs in Kor's sandbox. The probe writes a table with streaming, tool calls, thinking, structured output, cost, and duration. A model enters routing only when the probe records every capability as passing.

List the verified models without contacting the gateway:

```sh
pnpm kor models list
```

`GatewayAdapter.catalogue()` reads the same registry and filters the live catalogue to verified models. An empty registry leaves no model routable unless a caller supplies explicit compatibility data for a one-off probe.
