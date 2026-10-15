# Trace documentation claims

Use this procedure while writing and before finishing any documentation pass.
Keep the audit in `docs/claim-audit.md` (or the repository's existing equivalent).
For a targeted edit, audit affected claims and their dependants; for a full set,
cover every document in that set, including existing text retained unchanged.

## Attach authority to the claim

Give each rule, invariant or constraint a stable `CLM-001` style ID and cite its
source beside the statement. Sources must identify a spec/brief line or section,
a code path and symbol, or a ticket ID and quoted requirement. Include a short
source quotation or exact locator so the check can be repeated.

Preserve a supplied brief as a source file when it is otherwise only in the
request. Quote its actual wording; copying an invented rule into a brief does
not make that rule authoritative. Keep source material public-safe.

A derived claim cites its original authorities and the derivation. A generated
document may link to a canonical requirement, but follow that chain to the
original source: circular references and the claim itself establish nothing.
Implementation claims need code or observed runtime evidence; a desired feature
in a brief only supports a target, not a claim that the feature works now.

Repeat a claim ID for repeated occurrences of the same claim, preserving its
source citation. A new or stronger assertion needs its own ID and source check.
Keep citations outside copyable commands and example output.

## Fill the ledger

List every rule-like statement, not just sentences already labelled invariants.
Include requirements, guarantees, access restrictions, limits, non-goals, command
contracts, mandatory user steps and instructions embedded in tables or bullets.
Scan every covered document for these statements; words such as must, only,
always, never, every, exactly and strict are useful candidates, not an exhaustive
classifier. Planned rules need support too.

Use one row per claim, listing every location that repeats it:

| Claim ID | Document locations and exact claim | Authoritative source and quotation | Source check and correction |
| --- | --- | --- | --- |
| CLM-001 | Actual paths/sections and the statement | Actual source locator plus its relevant wording | Supported, derived (show why), corrected (old → supported statement), or removed (why unsupported) |

Populate this table from the actual documents and sources. Record removed claims
as well as retained ones so a reviewer can see what the audit caught. A summary
such as "all docs consistent" cannot replace the rows.

## Check meaning, then coverage

For each row, open the cited source and compare the complete claim with it.
Check its scope, conditions, quantifiers and strength. A citation that exists but
does not entail the assertion fails. Distinguish equality, inclusion and strict
inclusion; a conditionally true property cannot become an unconditional rule.
For data selection, check zero, some and all records matching the condition.
Record the counterexample or missing condition when it changes the statement.

Correct the claim to what its source supports or delete it. If a product choice
is missing, record an owned open question and a proposed default instead of
asserting the default as a rule. A proposal can cite the source constraint and
question that motivate it; it remains explicitly undecided. Unsupported existing
text, plausible conventions and repeated assertions are not exceptions.

Execute the bundled claim-ID check from the project root with Node. It compares
`README.md` and Markdown under `docs/` with `docs/claim-audit.md`, ignoring removed
ledger rows. Start a removed row's fourth-column result with `Removed`; other rows
are retained. Extra trailing columns do not change this result. Missing required
documents produce a JSON failure with exit status 1.
Record the actual output: both ID sets must be nonempty and both set differences
zero, with no removed IDs still in documents. For another established layout,
execute an equivalent extraction over the covered paths. A written assertion of
matching IDs without executing the check is not evidence.
Separately rescan for rule-like statements missing an ID or source
and add them to the audit. ID reconciliation proves bookkeeping, not entailment:
the per-row source comparison is still required.

Finish only with no unsourced or unchecked retained claims, no missing ledger
rows and no unsupported assertions left in the documents. Report counts for
supported/derived, corrected and removed claims, plus unresolved questions.
