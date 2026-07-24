# Facebook Cross-Post Runbook

Admin-approved cross-posting of featured showcases to the community Facebook Page.
Nothing publishes automatically — a mod must press **Approve** in the bot-log
channel for each post. This document covers setup, the token lifecycle, and
failure modes.

## What it does

1. When a showcase reaches the vote threshold and is published to the featured
   forum, the bot queues a **cross-post candidate** (only if the feature is
   enabled — see below).
2. The candidate is mirrored into the admin/bot-log channel with **Đăng lên
   Facebook** / **Bỏ qua** buttons.
3. An **Administrator** clicks Approve → the bot fetches a fresh image URL from
   the source Discord message and publishes a photo post to the Page.
4. Reject → the candidate is discarded, nothing is posted.

Video is **not** supported in v1 (image posts only).

## Prerequisites (external, one-time)

The bot needs a working Facebook Graph integration, which is separate from
simply owning a Page:

1. Create a **Facebook App** at <https://developers.facebook.com>. Add the
   "Facebook Login" and "Pages API" products.
2. Request the **`pages_manage_posts`** and **`pages_read_engagement`**
   permissions. These require **Business Verification + App Review**, which can
   take weeks and may be rejected by Meta. Submit a screencast showing the
   admin-approved cross-post flow as the use case.
3. After approval, obtain a **long-lived Page Access Token** (see token
   lifecycle below) and the numeric **Page ID**.

Until App Review passes, leave the feature disabled and copy posts to Facebook
manually.

## Environment variables

Set these in `.env` on the host (never commit real values):

```
FB_CROSSPOST_ENABLED=true          # feature flag; anything but "true" disables it
FB_PAGE_ID=<numeric page id>
FB_PAGE_ACCESS_TOKEN=<long-lived page token>
```

The feature is **fail-closed**: if `FB_CROSSPOST_ENABLED` is not `true`, or the
Page ID / token is missing, no candidate is ever queued and Approve returns
"cross-post đang tắt". No crash, no partial state.

## Token lifecycle

Page tokens derived from a long-lived user token are **effectively long-lived**
but are NOT immortal. They invalidate when:

- the linked user changes their Facebook password,
- the App secret is rotated,
- the granted permission is revoked, or
- the user loses their admin role on the Page.

To (re)issue a long-lived Page token:

1. Get a short-lived **user** token from the Graph API Explorer with
   `pages_manage_posts` + `pages_read_engagement`.
2. Exchange it for a long-lived **user** token:
   `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=<app-id>&client_secret=<app-secret>&fb_exchange_token=<short-user-token>`
3. Call `GET /me/accounts` with the long-lived user token → the `access_token`
   field on your Page entry is the long-lived **Page** token. Put that in
   `FB_PAGE_ACCESS_TOKEN`.

When the token invalidates, publishing fails closed and the error is logged
(redacted) to the admin channel; re-issue the token and restart.

## Security notes

- The token is sent in the **POST body**, never the query string, so it cannot
  leak via a logged request URL.
- All Graph errors pass through a redaction helper that strips the token and
  `access_token=` patterns before anything reaches the Discord admin log.
- The Approve/Reject handler checks `Administrator` as its first line
  (fail-closed) — it does not rely on the admin channel being hidden.

## Failure modes

| Symptom | Cause | Action |
|---------|-------|--------|
| Approve says "cross-post đang tắt" | Feature flag off or token/Page ID missing | Set the env vars, restart |
| Approve says "Đăng thất bại" | Graph API error (bad/expired token, policy, rate limit) | Check admin log (redacted error); re-issue token if expired. Buttons stay so you can retry |
| "Không lấy được ảnh nguồn" | Source Discord message deleted, or CDN URL expired and re-fetch failed | Nothing to publish; reject the candidate |
| Rows stuck in `PUBLISHING` after restart | Bot crashed mid-publish | On startup they are flipped to `NEEDS_REVIEW` and logged. Check the Page manually before any manual re-post — the bot will NOT auto-retry (avoids a duplicate public post) |

## Idempotency

- A double-click / two-device Approve is safe: an atomic `PENDING → PUBLISHING`
  claim means only the first click publishes; the loser returns "đã xử lý rồi".
- A crash between the FB publish and recording the post id leaves the row in
  `PUBLISHING`. On restart it becomes `NEEDS_REVIEW` (never blind re-posted),
  because a photo post carries no bot-owned marker to reconcile against.
