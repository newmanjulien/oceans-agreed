# Clerk authentication and rollout

The custom `/login`, `/join`, Settings, and deletion components adapt Overbase
revision `61c97882e42a2b3cbb4fccbb7448a954e147367d`. Signup ends after email
verification. Invitations are optional; anyone can sign up. All registered users
share Oceans, contracts, and the playbook. Only admins can edit the shared company
name and avatar in Settings; other access is shared.
Clerk owns identity and sign-in email. Convex owns names, avatars, roles, and company
settings. Settings never update another user's profile or Clerk's name.

## Development configuration

Create an Agreed **development** application in Clerk. Enable email verification
codes for signup and sign-in, open signup, self-deletion, and reverification for
sensitive actions. Disable required passwords, names, and legal acceptance so the
custom signup can finish with an email and code. Organizations and onboarding are
unnecessary. Configure `/login` and `/join` as the custom auth routes, `/` as the
fallback destination, and the frontend development origin as an allowed redirect.

Copy `.env.example` to `.env.local`, keeping the existing Convex deployment values.
Set `PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from this application.
Only the publishable key belongs in browser code.

Create Clerk's **convex** JWT template. Preserve its Convex defaults, including
`aud: "convex"`, and include these identity claims:

```json
{
	"aud": "convex",
	"email": "{{user.primary_email_address}}",
	"email_verified": "{{user.email_verified}}",
	"name": "{{user.full_name}}"
}
```

Clerk resolves the verification shortcode to a boolean. Agreed requires
`emailVerified === true`; an absent or false claim blocks profile initialization
and business operations. The issuer is the template's `iss` URL, including `https://`.

Configure the matching **Convex development deployment** with these backend values
before pushing the authentication config:

| Variable                       | Value                                            |
| ------------------------------ | ------------------------------------------------ |
| `CLERK_JWT_ISSUER_DOMAIN`      | Clerk's JWT issuer URL                           |
| `CLERK_SECRET_KEY`             | The same development application's server secret |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Signing secret of the webhook below              |
| `APP_URL`                      | Frontend origin, e.g. `http://localhost:5173`    |

Use the Convex dashboard to set secrets without including them in command history.
`APP_URL` also controls approval email links. Secrets are never public environment
variables. Each environment must use its own matching Clerk application and keys.

Add a Clerk webhook for **user.deleted** at
`https://<deployment>.convex.site/clerk/webhook`. Use the `.site` HTTP endpoint,
not `.cloud`. Copy its signing secret to the matching Convex deployment. A valid
delivery is acknowledged only after the permanent deletion marker commits.

Run `npx convex dev` against the intended development deployment, then `npm run dev`.
The browser uses Convex's authenticated Svelte integration with Clerk's `convex`
token. Each Clerk session gets a fresh Convex client; local snapshot caches are
scoped to identity and cleared on logout, deletion, or account changes. Server
snapshot reads forward an authenticated token and return `private, no-store`.

## Roles and permissions

`src/convex/permissions.ts` owns the role validator and capability policy. The
viewer query computes `permissions` from the stored profile role, so role changes
update the existing subscription without another request. Settings uses
`editCompanyProfile` to show the company name and avatar editors. Everyone can
edit their own name and avatar; their role is read-only.

Convex enforces capabilities through `requirePermission`. Company name saves
authorize in the writing transaction. Company avatar uploads authorize before
reading/storing the image and again in the committing mutation, using the current
authenticated profile. A demotion or deletion during upload prevents the commit;
the HTTP action deletes the newly uploaded blob after a rejected save.

New accounts default to `rep`. Assign an admin through the internal
`profiles.assignRole` mutation in the Convex dashboard: select the intended
deployment, identify the profile by its issuer-qualified identity, and supply
`{ "profileId": "<profile ID>", "role": "admin" }`. The same mutation accepts
`rep` to demote an account. There is no public role-changing endpoint. Existing
roles are preserved; review admins previously assigned through self-service role
selection before rollout.

For each future restriction, add a named capability to the policy and permissions
validator, use it in the affected UI, and enforce it in every backend operation
that needs it. Keep role comparisons in the policy; do not add restrictions just
because a route is named Admin.

## Session transitions and contract drafts

A persistent session controller coordinates connection, workspace preparation,
logout, and account loss. Temporary token or profile errors keep an admitted
workspace mounted with interaction blocked. A rejected connection shows retry
and logout actions; after ten seconds, a pending connection or preparation also
offers these actions. Retrying requests a fresh Clerk token and replaces the
Convex client while preserving mounted editors. Ordinary Clerk resource refreshes
do not reset the client or snapshot caches.

The session's stable client context scopes imperative queries, mutations, and
actions to the client that submitted them. Replacing or destroying that client
rejects outstanding calls with `ConnectionInterruptedError` before closing it.
Late SDK results are consumed without reaching the old callers; busy flags and
navigation/logout waiters can finish even when the SDK leaves its requests pending.
Subscriptions remain reactive and attach to the replacement client.
Identity changes also advance the session generation so a result delivered just
before teardown cannot update the next account's state.

Interruption does not cancel a server write. Contract saves replay their immutable
request after reconciling fresh metadata. Contract creation retries keep the original
operation ID and company name; a confirmed contract remains available if loading
its snapshot fails. A definitively rejected first creation releases its arguments
so a corrected name can be submitted. Once an attempt is uncertain, retries keep
its original arguments until creation is confirmed. Approval, Home, Settings, and invitation writes are not
automatically replayed. Their existing actions allow explicit retry after recovery.
Team refreshes invitations after recovery and stops interrupted batches with all
unconfirmed addresses retained. Approval eligibility uses fresh subscribed status.

Logout freezes editing and waits for pending contract saves before calling Clerk.
If saving fails or remains pending, the user can retry, cancel logout, or explicitly
discard local changes and log out. Canceling keeps the editor and its draft; a
request already handed to Convex can still commit. Playbook authoring participates
in the same guard: an in-flight save must finish, and unsaved manual edits require
canceling logout to save them or explicitly discarding them. Closing a session
bypasses editor navigation guards so they cannot block the login redirect.

Contract selection drafts have a separate operation journal in `sessionStorage`,
scoped to deployment, Clerk user, and contract. It records intended selections,
the confirmed base revision, any immutable pending request, and conflict status
before sending. Confirmed snapshot caches never contain unsaved intent. Drafts
survive refresh and unexpected session loss in the same tab; only the same signed-in
user can restore them. The browser discards them when the tab closes. If storage
is unavailable, an explicit warning says changes are retained only in memory.
Playbook authoring drafts remain in the mounted editor and do not use this journal.

Recovery waits for fresh authenticated server metadata. An acknowledged operation
is not replayed; an unchanged base can retry the original request; a changed base
retains the local selections and requires **Use latest version** or **Apply my
selections**. Conflicts remain explicit through refresh. Successful saves and
explicit discards remove the checkpoint. Successful account deletion clears all
of that user's drafts and prevents late callbacks from recreating them.

Matching selections alone never acknowledge an outstanding operation. The journal
keeps the submitted choices separate from the latest local choices: if a selection
is removed while its earlier save is pending, recovery resolves that earlier save
before saving the removal. A checkpoint remains until the operation is resolved and
the latest intent is confirmed, or the user explicitly resolves a conflict.
“Use latest version” pauses follow-up saving while waiting for an active request.
If its outcome is still uncertain, it retains the draft and reports failure.

## Existing contract attribution

Before the first sign-in, choose the account that should permanently own legacy
contracts. The first verified profile initialization records this owner atomically;
subsequent accounts cannot replace it. Business operations stay blocked while jobs
assign up to four contracts per transaction. The preparing screen remains until
the workspace's `ready` flag is true.

Rehearse on development data before production rollout. Inspect the shared
`workspace` record, confirm `legacyOwnerId` belongs to the intended account, and
confirm every `savedContracts` row has `creatorId`. The initial schema intentionally
keeps `creatorId` optional for compatibility with existing rows. **After verified
backfill completion on every deployment receiving the schema**, change its
validator to `v.id('profiles')` and deploy that final schema. New contract creation
already requires and atomically records the authenticated creator.

If that owner is deleted during attribution, their marker remains permanent.
Attribution finishes to the recorded owner before cleanup begins. It never moves
legacy contracts to a colleague.

## Deletion and recovery

Settings requires the phrase **delete my account**. Clerk deletion runs first,
with reverification and retry when needed. A Clerk rejection leaves Convex data
intact. Successful deletion clears local state and redirects directly to `/login`
from the persistent auth bridge, even if session loss has already removed the
deletion modal. It does not wait for a redundant sign-out request or Convex cleanup.
Protected routes also redirect when Clerk finishes loading without a session.

The verified webhook records an issuer-qualified deletion marker and queues
cleanup. That transaction immediately blocks the caller and excludes their
contracts from Home, direct reads, edits, and approval dispatch. Cleanup removes
contract-specific snapshots, approval records, contracts, personal avatar, and
profile in bounded batches. It preserves the shared company, playbook, shared
immutable template versions, colleagues, deletion markers, and retry receipts.
Pending approval sends are canceled when possible; delivered emails cannot be
recalled.

Every 15 minutes reconciliation checks registered profiles against Clerk with one
batch lookup per 25-profile page and resumes unfinished jobs. Only an account
missing from a complete, successful batch response records a deletion; network
errors and incomplete responses retain the account. Each deletion marker tracks
one cleanup job chain; repeated webhooks reuse an active chain, and stale jobs
do no work. Inspect `deletedUsers.complete` and scheduled-function failures to
diagnose incomplete cleanup. Fix the cause and run the internal
`accountDeletion.resume` mutation to resume work; keep deletion markers permanently.

## Verification before rollout

`npm run verify` runs the existing performance suite, Svelte/type checks, and
production build. Existing fixtures carry authenticated identities. Their saving,
conflict, retry, creation, immutable publication, scheduling, and cache assertions
remain in place; no new test suite was added.

Live Clerk configuration and browser checks require the development keys. Use two
accounts to check signup/login, code resend and back navigation, invitation ticket
signup, revoke/resend, explicit profile/company/avatar saves, trusted role changes,
creator attribution updates, and logout/account switching. Check the copied auth
and settings layouts on desktop/mobile, keyboard focus, Escape, and modal focus
restoration against the reference. Check anonymous Convex calls and the snapshot
HTTP endpoint are rejected.

Using one admin and one rep, confirm the company editors appear only for the admin
and both accounts can save personal names and avatars. Call `settings.saveCompanyName`
and POST `/avatar?company=true` directly as the rep and confirm rejection without
company changes. Confirm public self-promotion is unavailable. Demote an admin
while a company avatar upload is pending and confirm it cannot commit or replace
the existing avatar; check the rejected upload is cleaned up. Promote/demote via
`profiles.assignRole` and confirm Settings updates without a reload. The local
performance suite and build do not verify these live authorization checks.

On disposable development data, delete the initial owner midway through backfill,
redeliver the signed webhook, interrupt and resume cleanup, and simulate a missed
webhook by deleting an account in Clerk and waiting for reconciliation. Confirm
contracts become unreadable before physical removal and colleagues retain their
contracts, playbook, and company. Confirm a failed Clerk request never deletes data.
These live checks and the post-backfill required-field deployment are rollout gates;
the local build does not certify them. Do not run the destructive rehearsal on
production data.

Also check the session transitions with development accounts: interrupt the
connection during a selection save, start logout, and exercise retry, cancel,
and discard after the ten-second feedback appears. Reject token/profile requests
after opening a contract and confirm its editor stays mounted; retry and confirm
reconciliation uses the new client. Refresh with an unacknowledged save, sign back
in as the same user, and check both committed and uncommitted outcomes. Change the
contract from a second session and confirm neither recovery nor refresh silently
overwrites it. Switch users and confirm drafts do not restore across identities.
Repeat logout/session loss during contract creation and playbook authoring to
check navigation guards, failed Clerk logout, and callbacks from closed clients.
Finally, complete deletion while its modal unmounts and confirm direct navigation
to `/login` without waiting for webhook cleanup or an extra sign-out call.
