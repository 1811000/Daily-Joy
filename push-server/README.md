# Daily Joy: Alerts when the app is closed

Alerts need a small free server (a Cloudflare Worker) that sends a ping to your phone at reminder time.
Until you finish these steps, the "Alerts when closed" menu item shows "not set up yet" and nothing else changes.

You need: a free Cloudflare account, and the iPhone app installed on the Home Screen (iOS 16.4 or newer).

## 1. Make the keys

1. Open `push-server\make-keys.html` in your browser (double-click it).
2. Click **Make keys**.
3. Copy box 1 into a private note. This is the secret key.
4. Copy box 2. This is the public key.

## 2. Create the Worker

1. Go to https://dash.cloudflare.com, sign in, then **Workers & Pages > Create > Worker**. Name it `dailyjoy-push`, then **Deploy**.
2. Click **Edit code**, delete everything in the editor, and paste the whole of `push-server\worker.js`. Click **Deploy**.
3. Note the address shown, for example `https://dailyjoy-push.yourname.workers.dev`.

## 3. Add storage

1. In the Cloudflare dashboard go to **Storage & Databases > KV > Create**. Name it `dailyjoy`.
2. Back on the Worker, go to **Settings > Bindings > Add > KV namespace**. Variable name: `DJ`. Choose the `dailyjoy` namespace. Save.

## 4. Add the secrets and the timer

1. **Settings > Variables and Secrets > Add**:
   - Type **Secret**, name `VAPID_JWK`, value = box 1 from step 1.
   - Type **Text**, name `VAPID_SUBJECT`, value `mailto:` followed by your email.
2. **Settings > Triggers > Add Cron Trigger**: `* * * * *` (every minute). Save.

## 5. Connect the app

1. In `web\app.js`, find these lines near the top and fill them in:
   ```
   var PUSH_SERVER = 'https://dailyjoy-push.yourname.workers.dev';
   var VAPID_PUBLIC = '<box 2 from step 1>';
   ```
2. In `web\sw.js`, set the same address: `var PUSH_SERVER = 'https://dailyjoy-push.yourname.workers.dev';`
3. Copy both files to `publish\`, then upload them to GitHub Pages as before.

## 6. Test on the phone

1. Delete the old Daily Joy icon from the Home Screen and add it again from Safari (so it runs as an app).
2. Open it, then **menu > Alerts when closed**. Allow notifications when asked.
3. Add a task for 2 or 3 minutes from now with a time. Close the app completely.
4. The alert should arrive at the time you set.

## Notes

- Alerts only work when the app is installed to the Home Screen. iPhone does not allow them in Safari tabs.
- The server only sees the reminder titles and times you have, and only for your own phone.
- If something fails, the Worker's **Logs** tab in Cloudflare shows the errors.

## Update for v26 (Siri inbox)
The worker gained two small endpoints (/add and /pull) for 'Hey Siri, add to Daily Joy'. Paste the new worker.js into Cloudflare (Edit code) and Deploy. Nothing else changes; your keys and KV stay.
