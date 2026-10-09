# Playbook authoring and persistence

`AdminWorkspace` owns one `AuthoringSession` and passes it the shared compiled contract, indexed geometry, and accepted records.
The session owns one active local draft, validation, reconciliation and persistence.
`AuthoringFlow` owns creation steps, staged concession additions, selected ranges,
selection feedback and the last locally added concession preview. Components bind
to draft content and own presentation state such as menus and focus. The Convex
transport is a separate adapter. Neither the app layout nor the rep workspace owns
an authoring session.

## Explicit transaction boundary

Save validates and submits one complete immutable instruction-box snapshot. No
input observer, timer, dismissal, visibility event or navigation sends a save.
Cancel discards the active draft without writing. New Explain and Negotiate boxes
both end with Save; their initial selection only determines the local draft shape.
Existing boxes always expose the same instruction fields and concession sections.
Concessions display read-only descriptions. Changing a concession requires deleting
it and adding a new one; unchanged structured replacement references stay intact.

Adding a concession to an existing box stages it separately. Next changes steps;
Back preserves the secondary selection and replacement. Turning off “affects another
part” explicitly removes that secondary change. The nested Add action validates and
copies the concession into the parent draft without writing, while nested Cancel
discards only that addition. The added concession becomes read-only in the parent
draft. Unrelated incomplete parent fields do not block Add;
the parent must pass complete validation before Save. There are no per-field saves.

Outside clicks and Escape can dismiss a clean existing box. Dirty or unresolved
work stays open with inline feedback. New creation requires an explicit action.
Modal dialogs block underlying dismissal, and source picking includes the document
and selection toolbar in the interaction boundary. Internal navigation asks before
abandoning unsaved work and blocks while a save or delete is unresolved. Browser
unload only warns; local drafts are not durable across refresh.

## Operation outcomes and live reconciliation

Saving freezes editing and duplicate submissions. An acknowledged save or deletion
ends the workflow and closes the editor. The workspace restores the captured
annotation focus after the DOM updates and shows completion feedback for 2.5 seconds.
Operation errors and recovery actions remain beside the editor footer.

An uncertain transport outcome retains the exact frozen operation for Retry; there
is no new operation ID or queued replacement. A definite rejection leaves the draft
editable. Correcting its content permits a new save operation. A revision conflict
retains local work and offers Use saved version; it never silently overwrites or
merges another admin's edits. Missing records retain the local draft for explicit
cancellation. Editing and navigation remain blocked until an uncertain operation
has a definite outcome.

Clean drafts adopt newer live records. Dirty drafts become conflicted, and conflicts
track newer revisions and deletion. Updates received during an unresolved operation
are retained and reconciled after its result. An existing record's observed deletion
takes precedence over a conflict response. A creation conflict can arrive before
that record's first live-query appearance, so absence at that response alone is not
treated as deletion. Subsequent query updates reconcile it normally.

## Backend contract

`admin.savePlaybookItem` checks replays, missing records and expected revisions before
validation. Updates with semantically unchanged ordered Triggers and concessions
use source-independent item-content validation, reading only the target record.
Creations and structural changes validate the proposed live set atomically,
including source references, Trigger uniqueness/overlap, change boundaries,
concession update rules and supported-size limits. The database audit validates the
complete set. Accepted updates replace the full item and increment its revision;
legacy records start at revision zero. Repeated operations acknowledge the existing
result without writing again.

Creation receipts map an operation UUID to a database ID atomically and outlive
items. Retrying creation cannot duplicate or resurrect a deleted item; replay after
another edit reports a conflict. Delete is explicit and confirmed, requires a
resolved editable existing box, checks its revision, and is idempotent when the
record is already absent. It does not queue behind another operation.

Semantic comparison preserves business text and structured references while
excluding persistence metadata. Creation mode is not part of the business payload.
Live records and immutable snapshots contain no creation-mode field. Deploy schema
and mutations with the frontend. Optional revision metadata needs no reset or reseeding.

## Source selection and validation

Selection policy lives in `source-picking.ts`, with region-local geometry queries, structured issues and one
message formatter. Completed gestures are evaluated before showing actions or
accepting a secondary clause. Confirmed actions revalidate current source and items
before changing a draft. Initial eligibility checks source, Trigger and persisted
change invariants once, then checks concession-specific geometry separately.

The toolbar copies native start/end nodes and offsets alongside the accepted source
range. Changed endpoints invalidate actions; unchanged notifications, scroll and
resize preserve acceptance. Confirmation checks endpoints again before workflow
validation. Unsupported selection changes cannot confirm an earlier highlight.

Creation readiness combines session validation with a required secondary selection
on the other-part step. Complete session validation gates Save. Validation retains
original failures in a single-draft geometry memo and the validation result's
`diagnostic`, while `reason` contains safe
loading/size, translated geometry or generic fallback feedback. Revalidation clears
resolved feedback without changing transport or conflict outcomes.

## Contract concession reviews

Each required concession application has a lifecycle ID, saved atomically with the
selection. Changing, removing, or reapplying a choice creates a new application;
renaming the buyer or saving another choice preserves existing decisions. Required
choices applied by reps start pending; choices applied by admins start approved and
record the admin's decision. Legacy saved choices without metadata start pending.

Current review state lives on the saved contract. Admin decisions validate company
access, the immutable template's approval requirement, and the current selection and
lifecycle. Decisions update only review metadata, without advancing the selection
revision or invalidating document rendering and Word preparation. Live subscriptions
carry decisions to both roles; same-revision save responses cannot replace a newer
live decision. Each decision also appends the admin's identity, previous and resulting
status, and timestamp to `concessionDecisions`. Scoped operation receipts make retries
idempotent even after another admin decides; distinct committed decisions use the
latest status. Automatic approval receipts and review receipts have separate namespaces.
Live confirmation retires an ambiguous client attempt, so a later override uses a
fresh operation rather than replaying its earlier receipt.

Each applied concession owns one review state and one tab per affected part. Edits
owned by the same instruction trigger share a location; changes outside its triggers
are grouped by source container. This keeps an explicitly selected additional part
separate, including when it lies elsewhere in the same paragraph, and groups legacy
concessions with several edits in one part. Each location anchors once at its first
visible edit, without repeating across page splits. All instances use the same
concession decision. Choices without text changes anchor once per instruction trigger.
Trimmed source text falls back to the nearest visible token in the same passage.
An unavailable anchor does not block navigation to the remaining reviews. Different
locations stack when they overlap.
Source parsing, text measurements, and location projections are cached per immutable
page. Sorted source intervals limit projection scans to matching tokens. Appending
pages only scans the new content; scale changes reuse page-local
coordinates. Status changes update labels without remeasuring text, and only the
open review menu is mounted.
Admins can change either decision using the same menu; reps see read-only status and
remove a rejected choice to clear it. Reviews are disabled until the current application
is saved. Word download requires every selected required concession to be approved.

An explicit approval request freezes the pending applications and reviewed context
into the existing recoverable email dispatch. Sending an email never changes review
status. Its `?review=1` link waits for current state and mounted pages, then focuses the
first pending concession's tab. A stale link reports that nothing is waiting and focuses the first
remaining tab or document. After a decision, navigation advances to the next pending
application in source order and wraps. Navigation consumes each request by identity,
including when a workspace reopens a retained viewer. The stale-link message clears
when another concession starts waiting. Decision history is retained without a UI and
removed in bounded batches when the contract is deleted.
