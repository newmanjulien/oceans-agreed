# Account startup cleanup

Updated on October 9, 2026. The backend changes are on development deployment `scrupulous-squirrel-986`. Production has not been deployed or measured. [Account entry and workspace routes](account-routes.md) describes the current architecture; the earlier measurements below describe the preceding implementation.

## Resulting startup path

The root owns Clerk readiness, a persistent session controller, and startup preparation that warms an unused Convex connection during email verification. Public login and signup render their email form before Clerk is ready and own a replaceable navigation attempt with a safe local `returnTo`. A lazy authenticated account host owns the transport, live viewer, and membership cache identity across entry and workspace routes. The workspace layout separately admits company members and owns document and editor resources. Entry screens share the login shell without workspace chrome. Both stages use the shared loading wheel with no minimum display time. Home appears when authentication, membership, and its code are available; the contract list loads independently.

The surface disables its animation for reduced motion, reports errors inline, and exposes retry/logout controls after 10 seconds. Once admitted, the authenticated account subtree remains mounted and inert during connection recovery. Existing editor suspension, pending-save handling, and logout guards remain in place.

The protected server layout now performs only the authentication guard and safe login redirect, with `Cache-Control: private, no-store`. It does not fetch tokens, provision accounts, or fetch dashboard cards. The unused root Clerk SSR loader is removed. No account bootstrap data is serialized into route data.

The browser uses the authenticated live Convex viewer as its account preparation source. A confirmed missing-state result permits initialization once per transport generation. Returning accounts and pending legacy attribution remain read-only. Retries replace the transport and reread the live viewer before deciding whether initialization is still needed. Convex authentication is configured once per session and transport generation; unrelated Clerk resource updates leave the transport intact, and token refresh reads the current session resource. Home admission does not wait for the paginated live result. Contract-list requests have their own 15-second loading deadline, reset by a new search or transport generation; late successful results clear the local failure. The obsolete card cache reader, writer, validator, and rename/delete reconciliation are removed; account-isolated opening history remains.

The document renderer is dynamically imported when a document route needs it or saved-contract warming has candidates. Admin document queries belong to the Admin route. Opening Home does not start preparing the Admin document. Saved-contract warming begins after workspace admission, two animation frames, and an idle callback, with a bounded fallback. It pauses during search, navigation, recovery, and teardown. The preparation policy selects at most four saved documents, including reserved resources; only its selected candidates may fetch snapshots. Changes to that selection replace the fetch queue and cancel background reads that are no longer selected without treating cancellation as a preparation failure. Explicit document navigation keeps priority, and retained document ownership remains layout-scoped. Foreground snapshot loads additionally cancel unrelated background reads; a healthy matching flight is reused with its original deadline.

Navigation, Clerk loading, authentication, account preparation, document module loading, and document opening have 15-second read deadlines. The opening deadline runs until the workspace reports visibility or failure, including seeded creation handoffs waiting for fresh metadata; it is independent of snapshot availability. A new transport generation restarts a failed opening, while a workspace that already opened stays mounted. Snapshot flights have a 15-second total budget, including a 250-millisecond IndexedDB read budget before network fallback. The snapshot endpoint has a 12-second token-and-query budget and propagates cancellation to its Convex fetch. Revoked-session token lookup errors return a controlled response. Dependencies that ignore cancellation cannot leave callers waiting indefinitely or publish late snapshots.

Optional disk writes are coalesced per contract in a queue bounded to 24 pending operations and 32 MB of snapshot/metadata payloads, including the active write. A pending metadata update merges into a pending snapshot write; deletion supersedes pending content. IndexedDB opening has a 250-millisecond deadline and transactions have a one-second deadline. Teardown clears pending writes and aborts active transactions. These limits apply only to the optional cache, not server mutations or draft recovery. Snapshot sizing is shared between memory and disk, and disk hits reuse the stored immutable size. Disk and network snapshots are each validated once at their respective boundary.

Sign-in retries replace failed navigation attempts, including a protected-route redirect back to sign-in. Once the authenticated account host mounts, retries replace authentication transport, cancel pending snapshot reads, and preserve confirmed cache entries. Unresolved documents retry after authentication succeeds; admitted editors remain mounted. Saving and logout have no new deadlines: pending-save confirmation, cancellation, and discard behavior remain separate from read attempts.

The root uses a small Clerk session provider with Clerk's public script loader and session APIs. `svelte-clerk` 1.2.0 passed `Promise.resolve(undefined)` as its UI constructor when `prefetchUI=false`; ClerkJS 6 then rejected with `TypeError: e is not a constructor`. The session provider omits the unused UI option entirely and retains the context required by the existing hooks. `@clerk/shared` is a direct, pinned dependency at 4.39.0. Future Clerk upgrades should recheck login, signup, session changes, and script-load retry.

## Earlier bundle measurement

| Dashboard static JavaScript |  Before |   After | Reduction |
| --------------------------- | ------: | ------: | --------: |
| Raw bytes                   | 424,141 | 312,378 |    26.35% |
| Gzip bytes                  | 145,709 | 111,487 |    23.49% |

The snapshots are [baseline](performance/account-startup-baseline.json) and [optimized](performance/account-startup-optimized.json). The analyzer walks the unique static imports of SvelteKit's root layout, workspace layout, and Home page in the production manifest. Gzip is summed per emitted JavaScript file. Dynamic imports, the separate entry runtime, CSS, fonts, and hosted Clerk assets are excluded. These figures describe that static dependency graph, not total browser transfer or a measured latency improvement. Saved-contract warming may load document code after admission on a populated dashboard.

Reproduce after `npm run verify`:

```sh
node scripts/account-startup-bundle.mjs /tmp/account-startup-bundle.json
```

The script discovers those nodes by source path, so route-group ordering does not require hardcoded node IDs. The authenticated account, workspace, and Home components load dynamically. This script measures the static route shell and excludes their dynamic modules; its output cannot be read as the complete workspace download.

## October 9 review fixes

Account entry and the workspace now have separate route groups and separate admission requirements. The root session controller persists across both groups. Authenticated account code loads independently of the workspace; only a membership-admitted workspace mounts its header and document resources. The account owns cache identity, with root-session cleanup, so entry navigation preserves snapshots and opening history. Company setup and invitation resolution stay in the shared login presentation. See [Account entry and workspace routes](account-routes.md) for ownership and navigation.

Code requests preload the authenticated account host and requested route, with Workspace and Home imports for workspace/Home destinations. Invitation and onboarding destinations avoid those workspace imports. These downloads overlap email verification or Clerk startup on a direct protected request without mounting components or running account queries. Anonymous invitations defer resolution code and exclude Convex from their static graph. Actual login timing and transfer cost after this route split remain unmeasured.

Initial account admission also checks the controller's admitted state, so late viewer data cannot bypass a failed read attempt. Previously admitted content remains mounted through recovery. Initial Convex authentication uses Clerk's prefetched token; cache bypass follows an explicit refresh request or a replacement transport within the same account session. The document host uses the shared component loader, including its named workspace factory, timeout, retry, and stale-result handling.

Invitation inbox reads and link resolution now have independent 15-second deadlines after account admission. Inbox subscriptions and timers run only on the join step. A recovered transport restarts their read budgets, late inbox results clear its local timeout, and replaced or timed-out link-resolution attempts cannot publish late results. Empty invitation tokens use the existing error state. The workspace boundary derives membership from the live account viewer and keys workspace resources by profile and membership. Shared component loading follows the transport retry generation; old workspace teardown cancels only its captured cache instance.

The review also restored pagination through empty live pages, added independent contract-list loading deadlines, prevented optional document-host failures from blocking template preparation screens, closed warmed connections after failed code requests or invitation acceptance, and removed redundant auth-shell configuration and conditions. The existing 24 performance tests, Svelte/type checks, and production build passed. No tests were added. Current route-level browser checks are recorded in [Account entry and workspace routes](account-routes.md). Live login timing, network-stall recovery, failed chunk loading, and populated pagination remain unverified in the browser.

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
