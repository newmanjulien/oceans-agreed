# Agreed

A SvelteKit / Svelte 5 contract workspace backed by Convex.

The immutable contract source is separate from the Playbook. A Playbook Item has
one or more Triggers, optional instructions, and negotiation concessions. Each
concession applies an atomic set of source-coordinate Contract Changes.

`/` owns a `RepWorkspace` and `RepPlaybookPanel`. `/admin` owns an `AdminWorkspace`
and `PlaybookEditor`. Both share the document viewer, chrome and rendering
machinery. The viewer receives only the derived document overlay, not instructions,
draft state or save operations.

Admins select unowned source to create an item or click a Trigger to edit its
complete item. One local draft supports instructions, multiple Triggers, preferred
and rare concessions, multiple changes, and structured contract references.
Save validates and submits the complete instruction box; Cancel discards local
changes without writing. Adding a concession to an existing box updates only the
parent draft until that box is saved. Back preserves entered clause selections and
wording. Their concessions
are read-only, including newly added concessions in the draft. Changing a concession
requires deleting it and adding a new one.

Typing, outside clicks, Escape and tab visibility never save. Dirty drafts stay
open until Save, Cancel or confirmed abandonment during navigation. An unresolved
operation blocks editing and internal navigation; Retry sends the same immutable
operation. Rejections keep the draft editable, conflicts offer Use saved version,
and remote deletion is reported explicitly. Save/delete acknowledgments close the
editor and briefly show completion feedback. Delete requires confirmation. Local
drafts are not restored after refresh; browser unload warns while work remains.

Reps can apply one concession per item. Cross-item conflicts are explained and
blocked. Choices are workspace-local and reconcile against live item identities.
The renderer preserves source coordinates and stable prepared tokens, compiles
whole-block browser geometry into cached layout profiles, paginates the complete
document and reconciles unchanged pages before committing one current snapshot.
Saved alternatives can prewarm the normal geometry cache during idle time.
The layout shares pure compiled source and indexed Playbook geometry across routes;
item-aware ingestion keeps metadata-only updates out of rendering. Search discovers
matches from committed page tokens, and annotation owners register by membership.
Search refreshes from snapshot commit IDs. Save, render and
source status remain independently visible above document flow.

## Development

Node.js 22.12 or newer is required.

```sh
npm ci
npm run seed:verify
npx convex dev
```

Configure `PUBLIC_CONVEX_URL` and the Clerk development keys in `.env.local`.
For a fresh development deployment, run `npm run dev`, sign up, and create a
company. Copy its ID from the Convex dashboard, then run
`npm run convex:seed -- --company-id COMPANY_ID`. Each company starts without a
template; contract creation becomes available after its initial scoped import.
Follow [Clerk setup and rollout](docs/clerk-auth.md) before starting `convex dev`:
the backend needs the matching JWT issuer. Local verification and production builds
can run before Clerk is configured; the app shows a setup screen until keys exist.
The canonical bootstrap data is `data/convex`: 113 immutable blocks and
56 Playbook Items, containing 62 Triggers, 26 concessions and 66 changes.
The seed command refuses to overwrite edited runtime records and resumes an
interrupted items-first import. It is not a migration tool.

This schema uses required company scope and personal roles. Reset development data
before deploying it over legacy records, then recreate the company through normal
signup and reseed it. Follow [the fresh reset runbook](docs/private-companies-rollout.md#fresh-development-reset).

## Approval request email (preliminary)

An applied concession requires approval when its instruction box's “Changes need
to be approved” field contains nonblank text in the saved contract's playbook
snapshot. These concessions block Word download. Removing all of them restores
normal download eligibility. “Ask for approval” is available once the contract is
saved, connected, and free of errors or conflicts.

Requests capture the saved company name and every applied concession's description,
mark the concessions requiring approval, and omit approval-guidance text. The email
subject is `Approval requested — <company name>` and its single workspace link is
`APP_URL/contracts/<contract ID>`. One latest request per contract lives in the
`approvalRequests` table, separate from saving state and revisions. Requests capture
the company name and compact snapshot item IDs plus concession positions; the Node
action loads descriptions in batches of four and builds the full email there.
Contracts without previous requests need no backfill.

Configure these **Convex backend environment variables** on the intended deployment
with `npx convex env set NAME value` (not as public SvelteKit environment variables):

| Variable            | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| `SMTP_USER`         | `julien.newman@gmail.com`                                    |
| `SMTP_APP_PASSWORD` | Gmail app password for that account; setup deferred          |
| `APP_URL`           | Live app origin, without a query or fragment; value deferred |

Set each company’s approval recipient in Settings. Requests capture that recipient
when queued. Invitations also use these SMTP credentials and `APP_URL`.
Nodemailer uses `smtp.gmail.com:465` with TLS. Missing variables are listed in the
request's failure feedback. A durable marker records dispatch immediately before
SMTP. Recovery checks the scheduled action every minute and blocks all further
requests while that job is pending or running. A stopped job with no dispatch is a
confirmed failure. DNS failure (`EDNS`), message preparation failures (`EMESSAGE`
at `API` or `MAIL FROM`), explicit SMTP rejection, and authentication failures are
also confirmed failures; explicit retry is available as soon as the original job
ends.

An ambiguous failure after dispatch, including Gmail acceptance whose status could
not be persisted, a malformed final `DATA` reply without explicit rejection, or a
generic connection failure, is uncertain. All requests for that contract are
blocked for 10 minutes after uncertainty is detected. A scheduled mutation enables explicit
retry after the cooldown and original job completion. The recovery chain created
with the request owns every subsequent poll and cooldown job; result persistence
does not schedule jobs or restart the uncertainty detection time. Feedback explains
that a retry may deliver a duplicate email; the delay does not guarantee uniqueness.
Only status persistence is retried automatically, never SMTP. Success blocks
duplicates for identical selections; changed selections allow a new request after
the original job ends. Deletion atomically removes the request and contract, retaining
the shared immutable template version and canceling the send job only while pending or running. Missing or terminal
jobs do not block deletion; an email already dispatched cannot be recalled.
Completion and recovery match request IDs so old jobs cannot overwrite newer requests.

Delivery logs include request ID, operation stage, allowlisted error codes and SMTP
commands, numeric response code, and message ID on acceptance. Credentials, email
bodies, raw SMTP responses, and raw transport messages are excluded.

Before rolling this schema out to a deployment with embedded
`latestApprovalRequest` records, stop new requests and drain all old approval send
jobs. Use an intermediate schema retaining that optional field while adding
`approvalRequests`; convert each selected concession ID to its position in the
contract's immutable snapshot, capture its company name, and preserve sent/failed
results. Convert unresolved legacy sending records to uncertain with a fresh
10-minute cooldown. Remove embedded fields only after checking conversion counts,
then deploy this final schema. The inspected personal dev deployment had no
embedded records or scheduled jobs, so it required no conversion.

Sending an email keeps download blocked. This version has no approval decisions,
approver controls, attachments, or automatic unlocking. The
download restriction applies to the existing app interface. Gmail delivery remains
unverified until the credentials and live app URL are configured.

## Verification

```sh
npm run seed:verify
npm run verify
npm run check
npm run format:check
npm run build
```

`npm run db:audit -- --company-id COMPANY_ID` validates one company on the
configured deployment without comparing deployment-specific IDs to seed IDs. Add `--seed`
to require an exact business-data match to the local seed. The local
verifier uses deterministic row identities only within verification; no second
business identity is stored. It compares all 58 frozen compositor states,
including full source/provenance signatures, pagination token conservation and
server-rendered provenance attributes; see the [reference policy](docs/overlay-rendering.md#verification).

Contract creation, immutable publication, development measurements, and the staged
rollout are documented in [the creation report](docs/contract-creation-performance.md).

Agreed uses open verified email signup and private companies. Each account creates a
company, accepts an invitation, or waits for a colleague. There is no company
discovery or email-domain autojoin. Each user chooses Rep or Admin for themselves
in Settings; Admin grants company administration immediately. New profiles start
as Rep, company creators become Admin and owner, and invitations preserve personal
roles. Ownership is independent: owners can choose Rep and still transfer ownership.
Admins invite/remove colleagues and edit company settings. Contracts stay with the company when a colleague leaves or
deletes their account, with former-colleague attribution where needed. See
[authentication configuration](docs/clerk-auth.md) and
[the schema and rollout runbook](docs/private-companies-rollout.md).

See [workspace ownership](docs/persistent-workspace.md),
[rendering](docs/overlay-rendering.md), [performance](docs/rendering-snappiness.md),
and [editor lifecycle](docs/lifecycle.md).

### Authoring behavior

“Explain a clause” starts a summary draft. “Help reps negotiate” starts a
concession draft. This choice only routes local creation; every saved box exposes
the same editing capabilities. The staged concession itself determines which
creation steps are shown, so no separate mode is serialized or sent to the backend.

Creation mode is absent from live records and immutable snapshots. Optional revision
metadata remains compatible with existing records; deploy the Convex schema and
mutations together with the frontend.

Cold-start implementation, rollback flags, recorded evidence, and outstanding production
measurement gates are documented in [the performance report](docs/cold-start-performance.md).

The [document domain implementation report](docs/document-domain-runtime.md) records
ownership, the revision-writer audit, available verification, and open build/browser
gates for the incremental runtime refactor.

## Production-data seed restoration

The cleaned supplied Convex export is retained under `data/migration/source` as the
seed source of truth. These archives have been edited and are not byte-for-byte
originals. `npm run seed:restore-export` deterministically rebuilds both seed
files and the logical mapping. `npm run seed:reconcile` compares every record,
checks edit/save preservation, and compares generated contract output against the
old provision rules. `seed:verify` requires that reconciliation to pass.

Concessions retain optional `detail` and `after` copy; source text retains optional
bold/italic `marks`. These fields are validated, displayed, and preserved by edits.
Read [the reconciliation and cutover report](docs/production-data-reconciliation.md)
before any development rehearsal or production cutover. The seed command requires an explicit company and matching development/local
target; it cannot load production or overwrite existing edited content.
