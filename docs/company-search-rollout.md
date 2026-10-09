# Company search rollout

The development rollout to `shiny-buzzard-89` completed on 2026-10-05. The staged
company-name index was confirmed backfilled before switching search reads and
stopping prefix writes. Cleanup deleted four obsolete rows; a second call returned
`{ deleted: 0, isDone: true }`. A separate deployment removed the prefix schema,
indexes, and cleanup function, followed by deletion of the empty physical table.
The search index is active with backfill state `done`.

The frontend was verified locally against this development backend. No production
or public frontend deployment was performed. See [verification results](phase8-performance-results.md).

The sequence below documents the rollout for another explicitly authorized target.
The final working copy no longer contains the legacy table or cleanup function;
prepare the intermediate revisions before using this sequence on another target.

The current private-company backend scopes search by `companyId` and uses
`by_companyId_and_savedAt` for blank browsing. The global `by_savedAt` index has
been removed. Follow the [private-company rollout](private-companies-rollout.md)
for the current schema and authorization requirements.

## 1. Stage the index without switching functions

Prepare a separate deployment revision from the complete Phase 6 implementation.
Keep its prefix-based `browse`, `create`, `save`, `rename`, and `remove` functions
unchanged. Add only this search index to the `savedContracts` schema definition:

```ts
.index('by_savedAt', ['savedAt'])
.searchIndex('search_companyName', {
  searchField: 'companyName',
  staged: true
})
```

Retain `savedContractSearch` and both of its indexes. Do not deploy the final Phase
7 functions with `staged: true`: staged search indexes cannot be queried.

Deploy this index-only revision to the authorized target, then check
`savedContracts.search_companyName` in that deployment's dashboard indexes view.
Wait for backfill to finish before proceeding. Prefix reads and writes continue
throughout this step, and Convex maintains the staged index as contracts change.
Leave the shared working copy intact when preparing this deployment revision.

## 2. Switch reads and stop prefix writes

After confirming index readiness, deploy the intermediate search-switch backend. Its schema
removes `staged: true`; `browse` uses `withSearchIndex` for nonempty searches and
`by_savedAt` descending for blank browsing. The prefix table remains in the schema.
Retain the bounded internal cleanup function in this intermediate revision.
Deploy the matching frontend pagination-state fix as part of a public rollout.

Existing prefix-query pagination cursors belong to the old query. Reload open
browse pages after the switch to start fresh pagination sessions. Old cursors must
not be supplied to the new search query.

Before cleanup, manually verify in the authorized deployment:

- Search a common name, a final-word prefix, multiple words, and a name with case
  or punctuation differences; paginate through results without duplicates.
- Browse with a blank query; a changed save moves that contract to the front,
  while an unchanged save leaves `savedAt` intact.
- Rename and delete a saved contract; verify the reactive search results update.
- An empty page with more pages available still permits continuation. Only an
  exhausted empty result displays the definitive empty state.
- Check function logs/transaction metrics for changed saves and confirm they
  write no `savedContractSearch` rows.

Search matching and relevance ordering are Convex's built-in behavior. The SDK
version used for implementation is 1.46.0. Convex documents limits of 16 query
terms, 32 characters per indexed term, and 1024 scanned search results; search
primarily supports Latin-script names. These are service limits, not custom
prefix/post-filter behavior. The requested pagination target is capped at 48;
reactive cursor ranges may return more than that target. All optional pagination
arguments and result metadata are preserved.

## 3. Delete obsolete prefixes in bounded batches

Only after the switch is verified and all prefix writers have stopped, invoke
the internal function `savedContracts:cleanupSearchPrefixes` with `{}` on the
authorized target. Each invocation reads at most 100 rows with a 1,000,000-byte
read budget, deletes that batch, and returns `{ deleted, isDone }`.

Repeat calls while `isDone` is false. A partial or empty page is not proof of
completion; use `isDone`. The function starts from the remaining rows on each
call, so an interrupted or repeated call is safe and needs no cursor. It schedules
no follow-up work. Stop and inspect any error rather than running an unbounded
cleanup loop. Confirm a final call returns `{ deleted: 0, isDone: true }`.

After prefix writes stop, the legacy table becomes stale. Re-enabling the old
prefix readers requires a fresh rebuild of prefix data, even before cleanup.
Keep full-text search enabled while addressing any rollout problems.

## 4. Remove the empty table in a later deployment

After confirming the table is empty, remove `savedContractSearch` and its indexes
from `schema.ts`, and remove `cleanupSearchPrefixes` from `savedContracts.ts`.
Regenerate Convex types and deploy this removal separately to the authorized
target, then delete the confirmed-empty physical table using the dashboard's
table deletion action. Removing the schema alone leaves the physical table.
Do not combine table removal with the initial search switch.

Complete Phase 8's browser/network comparison against the 113-block document and
repeated Admin visits. Confirm the earlier subscription, geometry, overlay,
document-search, navigation, and unchanged-save acceptance criteria still hold.

References: [Convex full-text search](https://docs.convex.dev/search/text-search)
and the installed SDK's `src/server/schema.ts`, `query.ts`, and `pagination.ts`.
