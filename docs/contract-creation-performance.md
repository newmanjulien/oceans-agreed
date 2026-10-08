# Contract creation preparation and immutable templates

New contracts reference the current published template. The naming screen prepares
the actual viewer, then adopts that viewer after the server confirms creation.
Company names do not affect layout. There is no optimistic saved contract or draft
in persistent caches.

## Storage and publication

`templates.publishTemplate` captures and validates the complete live template and
publishes version metadata, version-owned blocks and items, and the indexed current
pointer in the same transaction as an admin save or deletion. Instruction changes
publish too. Replayed operations and missing-item deletions publish nothing.
Publication preserves original Playbook Item IDs and indexed selected-item lookup.
The complete snapshot must satisfy existing semantic checks, supported row counts,
and the 8 MB UTF-8 bound. Remaining transaction write/query capacity is checked
before and during copying; a failure rolls back both authoring and publication.

Version content is immutable and retained indefinitely in this release. Storage
therefore grows with each successful template save, including instruction-only
saves. The measured template contains 113 blocks and 56 items: each publication
adds 169 content rows plus version metadata. Garbage collection is deferred.

Existing contracts retain their per-contract snapshots without backfill. Shared
helpers load complete snapshots, blocks, and indexed selected items from either
format. Saving, approval validation, and approval descriptions use these helpers;
contract deletion removes only its own data and approval work, never a version.

Creation checks its retry receipt before the current pointer and version metadata,
then inserts exactly the contract and receipt. It does not read or compile template
content. The response includes authoritative contract metadata, version ID, revision,
and confirmed initial choices. Retries keep the original contract/version; a receipt
for a deleted contract returns `deleted`.

## Viewer handoff

The naming screen subscribes to the current published template and preloads saved
route code concurrently. One protected, inert draft resource prepares the document
using the existing progressive renderer and scheduler. Its stable owner and object
identify the viewer independently of its changing route association. Drafts count
against retention budgets and remain protected while the naming screen owns them.

After confirmation, a matching template seeds the snapshot cache with the same
snapshot references and explicitly adopts the resource before navigation. Its
workspace, viewer, renderer, wrapper, and page elements survive. A mismatch loads
only the server-returned immutable version and pins it for the opening; subsequent
admin publication cannot replace it.

One live contract-state subscription reconciles newer revisions and deletion before
revealing the page or enabling interactions. Cache seeding preserves newer revisions
and cannot revive a deleted contract. Bindings and ownership transfer during route
navigation. Cleanup destroys an unadopted draft; an adopted resource survives.
Opening errors retain the created ID, so Retry opens that contract without another
Create mutation. Cancellation adds neither a persistent draft nor opening history.
With `PUBLIC_CONTRACT_DOCUMENT_PREPARATION=0`, the ordinary progressive viewer uses
the confirmed snapshot directly.

## Development measurements

Measurements were taken on 2026-10-07 against personal development deployment
`scrupulous-squirrel-986`, using the same Chrome 154 profile, 1440 × 1000 viewport,
Vite development app, source template (113 blocks / 56 items), and unthrottled network
and CPU. Each implementation was measured with 20 prepared and 20 immediate-submit
openings. Prepared trials waited four seconds on the naming screen; cold trials
submitted as soon as its input appeared. “Cold” means immediate submission, not an
empty browser cache. These are sequential samples, not randomized production trials.

Bounded local timing marks record numbers and preparation status only, never company
names, contract IDs, or document text. They are enabled in development, or with
`PUBLIC_CONTRACT_PERF=1`, and retain at most 100 traces. Mutation timing includes
transport and client scheduling. The display marker follows the first visible-page
callback, route completion, and naming-dialog reveal; it is not a pixel rasterization
measurement. CDP network events and runtime counters were inspected separately.

All values are milliseconds, shown as p50 / p95 using nearest-rank percentiles,
rounded to whole milliseconds. Each row contains 20 openings.

| Flow                         | Samples | Create mutation | Confirmation → display | Click → display |
| ---------------------------- | ------: | --------------: | ---------------------: | --------------: |
| Baseline prepared            |      20 |       383 / 563 |             960 / 1471 |     1522 / 1949 |
| Baseline immediate submit    |      20 |      769 / 1140 |              335 / 466 |     1128 / 1579 |
| Implemented prepared         |      20 |        75 / 222 |              135 / 203 |       210 / 353 |
| Implemented immediate submit |      20 |       207 / 279 |              104 / 146 |       307 / 419 |

The prepared median click-to-display decreased by **86%** (1,522 → 210 ms).
Confirmation-to-display decreased by **86%** (960 → 135 ms). Immediate-submit median
click-to-display decreased from 1,128 to 307 ms. Mutation round trips also varied
substantially across sequential runs; these observations do not isolate server time
or establish a production latency guarantee. Automated checks establish the constant
creation work and browser inspection establishes reuse of the prepared document.

The baseline separates route navigation, subsequent snapshot retrieval, and render
reveal. The implemented flow confirms and adopts its local snapshot before navigation;
its final reveal phase includes waiting for the live state subscription. Those phases
have different boundaries and should not be treated as equivalent backend timings.

| Flow                         | Navigation | Baseline retrieval / implemented local handoff | Baseline render / implemented state-confirmed reveal |
| ---------------------------- | ---------: | ---------------------------------------------: | ---------------------------------------------------: |
| Baseline prepared            |    25 / 33 |                                     884 / 1389 |                                              55 / 85 |
| Baseline immediate submit    |      6 / 9 |                                      293 / 416 |                                              39 / 47 |
| Implemented prepared         |    40 / 53 |                                          5 / 7 |                                             82 / 155 |
| Implemented immediate submit |    25 / 30 |                                         4 / 11 |                                             73 / 113 |

Instruction-only admin saves now include full publication. Six development browser
mutation round trips measured p50 **232 ms** and p95 **729 ms**, using nearest-rank
percentiles. This small sample includes network time and is not a publication SLA.

The numeric samples are retained in
[baseline](performance/contract-creation-baseline.json) and
[implemented flow](performance/contract-creation-optimized.json).

## Verification evidence and limits

Automated regression checks cover initialization idempotence/concurrency and its
race with admin publication; immutable old content; publication replay/no-op behavior;
rollback after partial copying and invalid-template rejection; latest-version
creation, retries, and deleted receipts; two creation writes with no content reads;
both snapshot formats; saving and approval description reads; import maintenance;
exact-reference cache seeding, newer revision reconciliation, and deletion protection.
External email delivery is stubbed. Existing save, scheduling, rendering, and cache
performance assertions remain in place.

Chrome CDP observations checked a matching prepared opening for identical page and
wrapper objects, no additional composition/pagination/page mounts, no follow-up
snapshot request, and one live state subscription. Additional browser scenarios
checked immediate submission, live template updates while naming, version mismatch
and pinning, newer saved selections before confirmation, injected navigation/render
failures followed by retry, deletion during opening, cancellation, synthetic font
invalidation, and disabled retention. The font check exercises the browser font
invalidation event path; real delayed font delivery was not separately measured.
Capacity rejection is tested with transaction metrics, not by exhausting a live
production transaction. SMTP delivery and production performance remain unverified.
A first-use help dialog can overlap the document; measurements concern the document
viewer and naming-dialog handoff.

Final local checks passed: `npm run verify` (22 tests across four files, zero Svelte
errors or warnings, and production build), Convex TypeScript checking,
`npm run seed:verify` (58 compositor states and zero reconciliation mismatches),
changed-file Prettier checking, and `git diff --check`.

## Rollout and imports

The development rollout first deployed compatible schema/read support and atomic
admin publication while retaining legacy creation when no current pointer existed.
It then ran the idempotent internal `templates:initialize`, verified a complete
113-block / 56-item version and pointer, and deployed optimized creation with the
legacy fallback removed. No production deployment was performed.
The final development check confirmed complete live-template parity and no remaining
temporary browser-test contracts.

Production rollout requires separate authorization and the same staged sequence:

1. Deploy compatible schema/read support and atomic publication with the legacy
   no-pointer creation fallback temporarily retained. Do not deploy the final
   pointer-required creation handler first on an uninitialized deployment.
2. Run `templates:initialize` on the explicitly identified target. Inspect
   `templates:current` and verify complete source/item parity and the current pointer.
   Initialization is idempotent and cannot replace a newer admin publication.
3. Deploy the final optimized creation handler and preparation frontend only after
   pointer verification. Existing contracts continue using their original snapshots.

`npm run convex:seed` retains its development-only overwrite guard. It enters
`templates:beginImport` before changing data, verifies the final live seed, and calls
`templates:finishImport` to atomically publish the complete version and release
maintenance. Even an already-complete supported seed run republishes after final
verification. Imports block creation and authoring until publication completes.
An interrupted or failed import intentionally remains in maintenance; resume the
verified workflow rather than clearing maintenance before publication. Saved
contracts remain readable and editable against their immutable snapshots. Other
imports must use this same begin/import/verify/finish sequence on their explicitly
identified target. The reconciliation adapter also exercises publication while
checking business-data preservation; it does not deploy or import production data.
