# Plate Lab staging access gate

This standalone reverse proxy replaces the browser's username/password prompt at staging.platelabstudio.com with one password field. It does not change the app's Supabase/account authentication, app source/image, database or storage.

## Security and sessions

- Reuses the existing bcrypt password verifier, copied on the server from the current Traefik Basic Auth label. No plaintext password is needed for installation. Never print the verifier or include secrets in Git, image layers, chat, command arguments or logs.
- Every application request, including API, media and static assets, requires a valid gate session. Only /_staging-access and /_staging-access/logout are public gate endpoints. Unauthenticated application writes return 401; reads redirect to the password page.
- 256-bit random opaque sessions, stored only as SHA-256 digests in server memory. Cookie is __Host-platelab-staging, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain and no persistent browser expiration. Server expires sessions after eight hours. Browser session restoration can retain cookies until that server expiry. Restarting the gate invalidates sessions.
- POSTs to the gate require the exact HTTPS Origin; next-path validation prevents external redirects. Password bodies are capped at 4 KiB, never echoed or logged. Login attempts are limited to ten per client per minute and 120 globally per minute. The service is reachable only on the existing private Docker network, with no published port.
- Gate cookie is stripped before proxying; app cookies and Authorization remain intact. Protected responses are no-store. Direct browser Back after logout may display an old browser-held view, but fresh protected requests deny access.
- To sign out of the staging gate, visit https://staging.platelabstudio.com/_staging-access and choose “Sign out of staging access.” This does not sign out the separate app account.

## Deployment

Code/compose: /srv/platelab-staging-gate on the existing tpl host. Image platelab-staging-gate:20261008. Private network coolify. Upstream is the existing host port 3106 via Docker's host-gateway alias, so normal Coolify app container replacement remains supported.

The root-owned secrets/staging-password-hash file must be readable only by root and container UID/GID 65532 (group-readable 0440). Keep the parent directory root-only. The secret is mounted read-only. Do not run compose config or broad docker inspect commands that could reveal other credentials.

Build with docker compose build, then start with docker compose up -d. The build runs unit tests with the race detector. Test credentials are synthetic and never accepted by the deployed verifier.

Routing uses /data/coolify/proxy/dynamic/platelab-staging-password-gate.yaml. Priority 250 routes the new staging apex through this proxy. New staging www redirects to the apex. Existing Basic Auth routers stay configured as the protected rollback path. Existing old-domain redirects remain separate. Prepare and test the gate before atomically installing its proxy file; never disable Basic Auth first.

## Rollback and future password changes

Move only the new dynamic proxy YAML outside the watched dynamic directory; the existing Basic Auth router resumes. Verify a 401 Basic challenge before stopping the gate. Do not change app data, mounts, account auth or database.

If the staging password is changed later, refresh the server-only hash file from the new existing Basic Auth verifier and restart the gate. This invalidates all gate sessions. The old and new access mechanisms must use the same verifier; changing the Coolify password alone does not update this standalone gate.

No extra public hostname, database, mail delivery, external authentication provider or persistent access credential is introduced. Testing the real existing password requires the user to enter it directly in the HTTPS browser form, never in chat.
