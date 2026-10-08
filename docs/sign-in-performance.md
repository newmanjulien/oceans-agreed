# Sign-in performance

Updated on October 8, 2026. Application changes are implemented and verified locally. Production has not been deployed or measured.

## Resulting behavior

Login and signup render the editable email form in the server HTML. Hydration enables submission once an email is entered; it does not wait for Clerk. Typing and focus before hydration survive hydration. Native email validation still applies.

The root provider starts Clerk from an asynchronous script and preconnect in the HTML head. It exposes session context, readiness, a cancellable readiness promise, and explicit retry. It loads no Clerk UI and uses script events rather than polling. Script and session initialization share a 15-second deadline.

Submitting while Clerk is starting shows “Connecting…” and queues one submission. When Clerk becomes ready, it proceeds automatically and shows “Sending…”. A failed connection preserves the email and exposes “Try again”. Retrying the SDK does not send an email automatically; authentication mutation failures also require an explicit resubmission. Leaving the flow cancels queued work, stale responses cannot advance it, and an existing session takes priority over email or invitation submission. Authentication mutations remain serialized.

Ordinary `/login` and `/join` requests bypass the server Clerk handshake and use `Cache-Control: private, no-store`. Clerk callback parameters still use its server handler. An anonymous root document request with no authentication artifacts redirects directly to `/login`. Cookie presence selects that route only; protected layouts and API handlers still verify authentication.

The root now owns only Clerk readiness. Convex, workspace admission, session recovery, draft handling, and workspace cache ownership belong to the protected layout. Public authentication routes disable link preloading. Their initial JavaScript graph does not import the Convex client or workspace document/cache modules.

## Local measurements

| Measurement                                 |     Before |     After |
| ------------------------------------------- | ---------: | --------: |
| Fresh browser cache: hydrated form          |   1,163 ms | 98–165 ms |
| Warm navigation: hydrated form              | 265–269 ms | 60–103 ms |
| Fresh browser cache: first contentful paint |          — |  36–60 ms |
| Fresh browser cache: HTML response          |     591 ms |  23–29 ms |
| Fresh server-side Clerk redirects           |          3 |         0 |

These are small headless Chrome development samples with Vite already warm. Hydration is the point at which the form's client handler is mounted, not completion of Clerk authentication. Clerk can still take longer to connect; that work now runs alongside the form. The initial batch also confirmed an anonymous root request uses one direct redirect to login and makes no workspace module requests.

A cold-browser-cache check immediately after restarting Vite hydrated in 327 ms, despite painting in 36 ms. That load exceeded the 250 ms target. One confirmation warm navigation took 103 ms, slightly exceeding the 100 ms target. These observations establish a substantial improvement, not a guarantee for every development load. Production, slower devices, and latency percentiles remain unmeasured.

The Clerk development SDK can perform a later document reload during its browser handshake. The confirmation batch captured initial hydration before that reload and closed each tab immediately. The retained [browser report](performance/sign-in-browser.json) contains numeric timing and sanitized check results, without account identifiers or request tokens.

## Production JavaScript graph

| Public sign-in static JavaScript |  Before |   After | Reduction |
| -------------------------------- | ------: | ------: | --------: |
| Raw bytes                        | 213,445 | 164,889 |    22.75% |
| Gzip bytes                       |  76,494 |  60,933 |    20.34% |
| Unique emitted files             |      19 |      16 |         3 |

The [optimized manifest snapshot](performance/sign-in-optimized.json) walks unique static imports from the root layout and login page, currently generated client nodes `0` and `11`. Check generated route ordering if routes change. Gzip is summed per emitted file. Dynamic imports, the separate entry runtime, CSS, fonts, and the hosted Clerk SDK are excluded. This is a dependency-graph comparison, not total browser transfer or production latency.

## Verification

`npm run verify` passed: all 24 existing performance tests, Svelte/type checking with zero errors or warnings, and the production build. Existing saving, scheduling, caching, creation, and startup assertions were preserved; no tests were added or expanded for this change.

Review fixes make a redirect back to sign-in fail the navigation attempt so the existing retry can start a fresh request. Losing the session cancels pending work and clears the opening state. Empty invitation parameters follow ordinary email signup. The protected session controller no longer retains sign-in navigation methods, flags, or retry branches. These fixes passed `npm run verify` and source review; their component behavior has not been checked in a browser.

Temporary Chrome DevTools Protocol checks verified pre-hydration typing, delayed-SDK submission exactly once, cancellation when switching flows, and an SDK failure followed by explicit retry without automatic email submission. Live development Clerk checks verified email/code login, email/code signup, existing-session restoration, safe local return destinations, rejection of external return destinations, ordinary logout, and one invalid invitation-ticket attempt with an inline error. No uncaught exceptions were observed. No browser framework or committed browser automation was added.

Valid invitation acceptance, session expiry with pending edits, account switching, and logout cancellation/discard were reviewed only where affected; they have not been rehearsed in the browser for this change. The existing performance suite checks its current automated guarantees and does not directly cover all new readiness and cancellation paths.
