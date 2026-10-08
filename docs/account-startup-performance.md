# Account startup cleanup

Updated on October 8, 2026. The earlier backend cleanup was pushed to the development deployment `scrupulous-squirrel-986`; the recovery and public sign-in refactors change application code only. Production has not been deployed or measured. The current public-route architecture and measurements are documented in [Sign-in performance](sign-in-performance.md); the earlier measurements below describe the preceding implementation.

## Resulting startup path

The root owns only Clerk session readiness. Public login and signup render their email form before Clerk is ready and own a small, replaceable navigation attempt that preserves a safe local `returnTo`. After navigation, the protected layout owns the session controller, account preparation, cache identity, editor registration, and admission of the destination. The protected controller persists across workspace routes and is destroyed when leaving that layout. Both stages announce “Opening your workspace…” with no minimum display time. The dashboard appears when authentication, account readiness, and its first confirmed result or empty state are available.

The surface disables its animation for reduced motion, reports errors inline, and exposes retry/logout controls after 10 seconds. Once admitted, a workspace remains mounted and inert during connection recovery. Existing editor suspension, pending-save handling, and logout guards remain in place.

The protected server layout now performs only the authentication guard and safe login redirect, with `Cache-Control: private, no-store`. It does not fetch tokens, provision accounts, or fetch dashboard cards. The unused root Clerk SSR loader is removed. No account bootstrap data is serialized into route data.

The browser uses the authenticated live Convex viewer as its account preparation source. A confirmed missing-state result permits initialization once per transport generation. Returning accounts and pending legacy attribution remain read-only. Retries replace the transport and reread the live viewer before deciding whether initialization is still needed. Convex authentication is configured once per session and transport generation; unrelated Clerk resource updates leave the transport intact, and token refresh reads the current session resource. Dashboard admission waits for the first confirmed paginated live result. The obsolete card cache reader, writer, validator, and rename/delete reconciliation are removed; account-isolated opening history remains.

The document renderer is dynamically imported when a document route needs it or saved-contract warming has candidates. Admin document queries belong to the Admin route. Opening Home does not start preparing the Admin document. Saved-contract warming begins after workspace admission, two animation frames, and an idle callback, with a bounded fallback. It pauses during search, navigation, recovery, and teardown. The preparation policy selects at most four saved documents, including reserved resources; only its selected candidates may fetch snapshots. Changes to that selection replace the fetch queue and cancel background reads that are no longer selected without treating cancellation as a preparation failure. Explicit document navigation keeps priority, and retained document ownership remains layout-scoped. Foreground snapshot loads additionally cancel unrelated background reads; a healthy matching flight is reused with its original deadline.

Navigation, Clerk loading, authentication, account preparation, document module loading, and document opening have 15-second read deadlines. The opening deadline runs until the workspace reports visibility or failure, including seeded creation handoffs waiting for fresh metadata; it is independent of snapshot availability. A new transport generation restarts a failed opening, while a workspace that already opened stays mounted. Snapshot flights have a 15-second total budget, including a 250-millisecond IndexedDB read budget before network fallback. The snapshot endpoint has a 12-second token-and-query budget and propagates cancellation to its Convex fetch. Revoked-session token lookup errors return a controlled response. Dependencies that ignore cancellation cannot leave callers waiting indefinitely or publish late snapshots.

Optional disk writes are coalesced per contract in a queue bounded to 24 pending operations and 32 MB of snapshot/metadata payloads, including the active write. A pending metadata update merges into a pending snapshot write; deletion supersedes pending content. IndexedDB opening has a 250-millisecond deadline and transactions have a one-second deadline. Teardown clears pending writes and aborts active transactions. These limits apply only to the optional cache, not server mutations or draft recovery. Snapshot sizing is shared between memory and disk, and disk hits reuse the stored immutable size. Disk and network snapshots are each validated once at their respective boundary.

Sign-in retries replace failed navigation attempts, including a protected-route redirect back to sign-in. Once inside the protected layout, retries replace authentication transport, cancel pending snapshot reads, and preserve confirmed cache entries. Unresolved documents retry after authentication succeeds; admitted editors remain mounted. Saving and logout have no new deadlines: pending-save confirmation, cancellation, and discard behavior remain separate from read attempts.

The root uses a small Clerk session provider with Clerk's public script loader and session APIs. `svelte-clerk` 1.2.0 passed `Promise.resolve(undefined)` as its UI constructor when `prefetchUI=false`; ClerkJS 6 then rejected with `TypeError: e is not a constructor`. The session provider omits the unused UI option entirely and retains the context required by the existing hooks. `@clerk/shared` is a direct, pinned dependency at 4.39.0. Future Clerk upgrades should recheck login, signup, session changes, and script-load retry.

## Earlier bundle measurement

| Dashboard static JavaScript |  Before |   After | Reduction |
| --------------------------- | ------: | ------: | --------: |
| Raw bytes                   | 424,141 | 312,378 |    26.35% |
| Gzip bytes                  | 145,709 | 111,487 |    23.49% |

The snapshots are [baseline](performance/account-startup-baseline.json) and [optimized](performance/account-startup-optimized.json). The analyzer walks the unique static imports of SvelteKit's root layout, protected layout, and dashboard page in the production manifest. Gzip is summed per emitted JavaScript file. Dynamic imports, the separate entry runtime, CSS, fonts, and hosted Clerk assets are excluded. These figures describe that static dependency graph, not total browser transfer or a measured latency improvement. Saved-contract warming may load document code after admission on a populated dashboard.

Reproduce after `npm run verify`:

```sh
node scripts/account-startup-bundle.mjs /tmp/account-startup-bundle.json
```

The script currently identifies those three SvelteKit nodes as 0, 2, and 4. Check the generated route manifest if routes or layout ordering change.

## Earlier browser observations

Before this recovery refactor, the Clerk provider was exercised through normal email/code login and signup using Clerk's official development testing-token mechanism and development test addresses. A body-change observer and browser network events were used directly through Chrome DevTools Protocol. No browser test framework or additional committed browser tests were added.

| Flow            | Server bootstrap duration | Accepted auth to usable dashboard | Accepted auth to paint marker |
| --------------- | ------------------------: | --------------------------------: | ----------------------------: |
| Returning login |                  322.7 ms |                          532.4 ms |                      552.7 ms |
| New signup      |                  878.3 ms |                        1,081.3 ms |                    1,106.3 ms |

Each row is one warm development-browser observation with an empty dashboard. Time spent entering email or waiting for a code is excluded. The paint marker runs after two animation frames; it is an application marker, not a browser-reported pixel-paint measurement. There is no comparable authenticated baseline, production sample, median, or p95.

Both flows showed the auth form, its submission state, the shared startup surface across navigation, and then the complete empty dashboard. The observed dashboard live query paths were `profiles:viewer` and `savedContracts:browse`. No Admin queries, document-host/renderer modules, or uncaught exceptions were observed in the final login/signup checks. Logout returned to the login form.

Direct Settings and Admin navigation were checked before the final Clerk provider replacement. Settings loaded without document code. Admin loaded its document host and editor on demand. Their observed live queries included the viewer and Admin's `contract:getBlocks`/`playbookItems:list`; neither deep route fetched `savedContracts:browse`.

With the Clerk script deliberately delayed, Home showed the startup surface, an unanimated loader under reduced motion, and retry/logout controls after 10 seconds. The SDK's script timeout subsequently produced the inline sign-in load error. Clicking retry after removing the delay reached the dashboard successfully.

## Verification of the recovery refactor

`npm run verify` checks the existing five performance test files (24 tests), Svelte/type checking, and the production build. The affected startup test now exercises the live preparation owner while preserving returning-account read-only behavior, one-time missing-state initialization, and no attribution rescheduling. Existing caching, saving, creation, and scheduling assertions remain intact. No additional tests or committed browser automation were retained.

During the earlier recovery refactor, browser automation was stopped at the user's request. The subsequently authorized sign-in implementation has its own completed targeted browser checks in [Sign-in performance](sign-in-performance.md). Before it stopped, baseline collection captured four email/code logins before Clerk rate limiting and 25 authenticated dashboard reloads. Document baseline collection and an optimized comparison were not completed. These partial development samples do not establish a before/after median, p95, or latency improvement; earlier measurements above describe the earlier implementation only.

The new timeout, cancellation, stale-attempt, and session recovery paths were reviewed in code but have no dedicated automated coverage. Populated dashboard search/pagination, rename/delete, large/direct document opening, session expiry with pending edits, and logout cancellation/discard remain unverified in the browser after this refactor. Production and slower-device performance remain unmeasured.

Startup instrumentation is enabled in development or with `PUBLIC_CONTRACT_PERF=1`. `window.__accountStartup` retains at most 100 entries containing an event name, numeric attempt ID, and numeric timing. Events include `sign-in-hydrated`, `clerk-script-available`, `clerk-ready`, `auth-accepted`, `navigation-started`, `usable`, and `dashboard-painted`; the obsolete server bootstrap marker is removed. Entries contain no tokens or account identifiers.
