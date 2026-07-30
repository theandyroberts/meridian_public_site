# Google authentication

The application supports Google OAuth through Supabase Auth. Keep the button
hidden until both Google and the self-hosted Auth service are configured.

## Staging URLs

- Website origin: `https://staging.theplatelab.site`
- Supabase API: `https://supabase-staging.theplatelab.site`
- Google authorized redirect URI:
  `https://supabase-staging.theplatelab.site/auth/v1/callback`
- Supabase application redirect allow-list:
  `https://staging.theplatelab.site/auth/callback**`

## Google Cloud

Create an OAuth 2.0 Client ID with application type **Web application**.

Add the staging website as an authorized JavaScript origin and the Supabase
Auth callback above as an authorized redirect URI. Production should use a
separate OAuth client or an explicitly reviewed set of production origins and
redirects.

## Self-hosted Supabase Auth

Provide these values to the Supabase Auth container through the Coolify service
stack. Keep the client secret out of the repository and out of the Next.js
resource.

```text
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<Google OAuth client ID>
GOTRUE_EXTERNAL_GOOGLE_SECRET=<Google OAuth client secret>
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://supabase-staging.theplatelab.site/auth/v1/callback
GOTRUE_URI_ALLOW_LIST=https://staging.theplatelab.site/auth/callback**
```

The Coolify Supabase compose template may map stack-level variables such as
`GOOGLE_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_SECRET`, and
`ADDITIONAL_REDIRECT_URLS` into these `GOTRUE_` values. Confirm the values are
present inside the Auth service after restarting it.

Verify:

```bash
curl \
  -H "apikey: $TPL_STAGING_ANON_KEY" \
  https://supabase-staging.theplatelab.site/auth/v1/settings
```

The response must contain `"google":true`.

## Next.js staging resource

After the Auth settings endpoint reports that Google is enabled, add this
client-safe build/runtime variable and restart the website:

```text
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true
```

No Google client secret or Supabase service-role credential belongs in the
website resource.
