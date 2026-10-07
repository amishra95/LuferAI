# WhatsApp & Slack channels

Guests and teams can ask for venues and file booking requests over WhatsApp and Slack. Every
message runs through the **Channel concierge** agent and the same booking path as the client
portal (`lib/bookings/place-booking.ts`): rate-card pricing, minimum spend, date holds, corporate
policy and manager approval.

| Piece | Where |
| --- | --- |
| Webhooks | `app/api/webhooks/whatsapp/route.ts` (GET verify, POST messages), `app/api/webhooks/slack/route.ts` |
| Agent | `lib/channels/agent.ts`: model tool loop (`searchVenues`, `createBooking`) with the sender's last 30 minutes of messages; deterministic parser when no `OPENAI_API_KEY` |
| Storage | `lib/channels/store.ts`: Supabase when configured, server memory otherwise |
| Schema | `supabase/migrations/20261007120000_channel_integrations.sql` |
| Admin UI | Settings → Channels & Integrations (setup, sender links, test console) |

## How a message is handled

1. The signature is checked over the raw body (`X-Hub-Signature-256` / `X-Slack-Signature`, with
   Slack's 5-minute replay window). Unsigned or stale requests get `401`.
2. The delivery ID is recorded in `channel_webhook_receipts`; platform retries are acknowledged and
   dropped, across server instances.
3. The route answers `200` immediately. The agent runs in `after()`, then the reply is sent via
   the Graph API / `chat.postMessage` and the outcome is written to `channel_messages.delivery_status`.
4. If storage is unavailable the route answers `503`, so Meta and Slack retry later instead of
   losing the message.

Only senders **linked** in Settings (phone number or Slack member ID → client user) can book; they
book as that user, under that user's company. Anyone else can search.

## Database

```bash
npm run db:reset                 # local: re-applies all migrations + seed
# or, against a hosted project:
npx supabase db push
npm run db:types                 # regenerate lib/supabase/database.generated.ts
```

With `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, the channel switches, sender
links and message log persist in Postgres. Without them everything still works in memory and
resets when the server restarts.

## Local testing with ngrok

Meta and Slack must reach your machine over public HTTPS.

1. Start the app and a tunnel:

   ```bash
   npm run dev
   ngrok http 3000
   ```

2. Put the tunnel's https origin in `.env.local` (no trailing slash) and restart `npm run dev`:

   ```bash
   PUBLIC_BASE_URL=https://<id>.ngrok-free.app
   ```

   Settings → Channels now shows webhook URLs on that origin. Keep using the app itself at
   `http://localhost:3000`: credentials and sender links can only be edited from localhost, and
   `next dev` doesn't serve its dev assets to other hosts.

3. Free ngrok URLs change on every restart; update `PUBLIC_BASE_URL` and the URLs registered with
   Meta and Slack when that happens (or use a reserved ngrok domain).

### WhatsApp (Cloud API, Graph v23.0)

1. In [Meta for Developers](https://developers.facebook.com/apps), create a **Business** app and add
   the **WhatsApp** product. WhatsApp → API setup gives a test number, its **Phone number ID** and a
   24-hour access token; add your own phone as a recipient.
2. Set the credentials in Settings → Channels → WhatsApp → Setup (or `.env.local`):
   `WHATSAPP_VERIFY_TOKEN` (any string), `WHATSAPP_APP_SECRET` (App settings → Basic),
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. `WHATSAPP_GRAPH_VERSION` defaults to `v23.0`.
3. WhatsApp → Configuration → Webhook → **Edit**: callback URL
   `https://<id>.ngrok-free.app/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`.
   Meta calls the GET handshake immediately, so the app must be running with the token set.
4. Under Webhook fields, **subscribe to `messages`**.
5. Link your phone number in Settings → Channels → WhatsApp → Senders, then message the test number:
   `Dinner for 40 in Indiranagar on 20 Nov, ₹2,500 a head`, then `book Copper Courtyard`.

For production, replace the 24-hour token with a System User token (Business settings → Users →
System users) that has `whatsapp_business_messaging` and `whatsapp_business_management`.

### Slack (Events API)

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) (From scratch).
2. **OAuth & Permissions** → Bot Token Scopes: `chat:write`, `app_mentions:read`, `im:history`.
   Install to the workspace and copy the **Bot User OAuth Token** (`xoxb-…`).
3. **Basic Information** → copy the **Signing Secret**.
4. Save both in Settings → Channels → Slack → Setup and make sure the app is running: Slack
   verifies the URL the moment you paste it.
5. **Event Subscriptions** → enable, Request URL `https://<id>.ngrok-free.app/api/webhooks/slack`
   (should show *Verified*). Subscribe to bot events `app_mention` and `message.im`, then save and
   **reinstall** the app when prompted.
6. **App Home** → Messages tab → allow users to message the app.
7. Link your member ID (profile → ⋯ → Copy member ID) in Settings → Channels → Slack → Senders,
   then DM the bot or `@mention` it in a channel; replies land in the thread.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Meta: "The callback URL or verify token couldn't be validated" | App not reachable through the tunnel, or `WHATSAPP_VERIFY_TOKEN` differs |
| Webhook returns `401` | Wrong `WHATSAPP_APP_SECRET` / `SLACK_SIGNING_SECRET`, or (Slack) server clock skew over 5 minutes |
| Webhook returns `503` | Channel credentials missing, or Supabase unreachable |
| Message logged but "not delivered" | Outbound send failed: expired WhatsApp token, recipient not allowed on a test number, or the Slack bot isn't in the channel |
| Bot answers but never books | Sender isn't linked in Settings, or the request fails pricing/policy (the reply says why) |
