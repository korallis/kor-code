# Tracker verification (LEE-1323)

Verified on 16 October 2026 against a disposable repository under `korallis` and
GitHub Project v2, with a separate Kor HOME. Browser verification used the real
HOME and a unique chrome-devtools-axi session. The throwaway repository and
Project were deleted after verification. No tests were added.

| Check | Observed result |
| --- | --- |
| Plain Issues intake | Externally created issue with `kor` ran in an isolated checkout; acceptance passed; status labels moved through running and review; progress/outcome comments and a ready PR were written. |
| Project v2 intake | Externally created Project issue with `kor` ran and passed acceptance; Status moved to In Progress and In Review; progress/outcome comments and a ready PR were written. |
| PR linkage | Plain flow wrote `Closes owner/repository#1`; Project flow configured for references wrote `Refs owner/repository#4`. |
| Home box | Real Mission Control created and queued issues in plain Issues and in the configured Project. Fresh Project creation passed after fixing the mutation/list-index consistency delay. |
| Remote lifecycle | Both adapters read back queued, running, review, complete and canceled writes; complete/canceled closed the issue with the corresponding reason and queued reopened it. Project Done was visible in Mission Control. |
| Durable replay | Repeated creates returned the same issue; repeated comment writes left one marker/comment. |
| Priority/order | Priority updates read back as urgent and placed the issue first in each adapter’s candidate list. |
| Images | PNG attachment through the adapter and `kor github attach-image` reused its content-addressed asset; authenticated download matched every original byte; one image URL remained in the body. |
| Mission Control | Projects, Issues, Home/Next up, tracker selectors and Project settings were exercised through chrome-devtools-axi. |
| Doctor | GitHub tracker check passed with Project status mappings; no Linear key check for the all-GitHub configuration. The independent gateway management-key check remained unavailable in the isolated environment. |
| Linear | Live LEE-1323 full issue and project-summary reads matched the router; fake/HTTP issue and list values matched. Existing Linear lifecycle/conformance, daemon and shipping proofs passed. |
| Static validation | Workspace build, workspace/scripts typecheck and shell syntax checks passed. |

The live shipping proof reached ready pull requests and In Review. Jev’s existing
merge-confidence gate retained those PRs for review; it was not weakened or
bypassed. Done/closed/reopened transitions were verified separately against real
GitHub Issues and the Project Status field. Existing shipping proof also covered
observed merge → Done through the shared queue/outbox.

The live run also exposed two adapter bugs: hidden replay markers could become an
extra acceptance condition, and a Project item could be missing from its list
immediately after creation. Markers are excluded from acceptance parsing; Project
creation uses the returned item ID and waits for list visibility before queueing.
