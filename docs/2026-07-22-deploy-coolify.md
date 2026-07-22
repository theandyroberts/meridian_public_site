# Deploy — theplatelab.site (Coolify)

As of 2026-07-22 the site deploys via **Coolify**, replacing the old GitHub
Actions → pm2 pipeline (retired; `deploy.yml` deleted, `DEPLOY_*` secrets removed).

## How it deploys

- **Coolify control plane:** `http://51.81.83.175:8000` (separate host).
- **Deployment server:** `51.81.202.126` (OVH); nginx vhost `theplatelab.site`
  proxies `/` → `127.0.0.1:3105` → the app container (`:3000` inside).
- **App:** Coolify resource `l8ibin8t2epih7cvazluqq6c` ("platelab-web"), tracks
  branch `main`. Images are tagged by commit SHA.
- **Build (nixpacks, Node 22):** install `npm ci`, build `npm run build`, start
  `cd web && npx next start -p 3000 -H 0.0.0.0`.
- **Auto-deploy:** a GitHub repo webhook → Coolify's manual webhook endpoint
  (`/webhooks/source/github/events/manual`), signed with a shared secret. A push
  to `main` triggers a rebuild when Auto Deploy is enabled on the app.

## Gotchas

- **`NODE_ENV=production` must NOT be "Available at Buildtime."** In production
  mode `npm ci` skips devDependencies (TypeScript etc.), which breaks the Next
  build's `@/*` path resolution. Set it runtime-only in Coolify env vars.
- **Runtime state is not in git** (`web/data/catalog.json`, `web/public/media/`,
  `web/data/stitch-reports/`). It lives on the deployment server / in the app's
  persistent storage, not baked into the image.
- The stage viewer (`/stage`) is a static build committed under
  `web/public/stage/` (source in `viewer/`); it needs no build step of its own.
