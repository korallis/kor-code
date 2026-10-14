# Model compatibility

Kor records model checks in `~/.local/state/kor/models.json`. Set `KOR_MODEL_REGISTRY` to use another file during a probe or a local proof.

Run a probe against the live `/v1/models` catalogue:

```sh
pnpm kor models probe --family claude
```

Each selected model runs in its own Kor sandbox session. The probe requests a tool call, extended thinking, and a final JSON object, then checks those results independently. The table reports `pass`, `fail`, or `absent` for streaming, tool calls, thinking, and structured output. A model enters routing only when every capability is measured and passes. Use `--dry-run` to print the selected models without starting sessions.

List the verified models without contacting the gateway:

```sh
pnpm kor models list
```

`GatewayAdapter.catalogue()` reads the same registry and filters the live catalogue to verified models. Explicit `modelCapabilities` supplied by an adapter caller remain routable for fixtures and one-off proofs. An empty registry leaves live models unroutable until a probe records them.
