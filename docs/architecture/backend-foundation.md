# Backend foundation

This first backend slice establishes project access and private plan uploads for the later editor and media library.

## Runtime pieces

- `apps/api`: Fastify routes, bearer-token verification, project authorization, and signed upload/read URL operations.
- `apps/worker`: pg-boss consumer and database outbox publisher for upload verification.
- `packages/contracts`: shared Zod input and error schemas.
- `packages/database`: Drizzle schema, PostgreSQL connection, and versioned SQL migration.
- PostgreSQL: internal users, external identities, project memberships, upload metadata, and durable job/outbox records.
- S3-compatible storage: private object bucket; local development uses MinIO.

## Authentication and authorization

Auth0 owns sign-in, email verification, account recovery, and browser sessions. The future React app should use Auth0 Authorization Code Flow with PKCE and request an access token for the HomeSpace API audience. The API accepts only RS256-signed access tokens with the configured audience, exact Auth0 issuer, and configured SPA client ID (`azp`); it gets signing keys from that tenant's JWKS endpoint. The API does not store passwords, accept ID tokens as API credentials, or depend on Auth0 cookies.

Create an Auth0 **Single Page Application** and a separate **API** in the Auth0 dashboard. Set the API identifier as `AUTH0_AUDIENCE`, use RS256 signing, and set the tenant or custom host without `https://` as `AUTH0_DOMAIN`. For the planned local Vite app, allow `http://localhost:5173` as a callback URL, logout URL, and web origin; add the deployed URLs when hosting is chosen. The React client needs the Auth0 domain, SPA client ID, and API audience; the SPA does not need a client secret. `AUTH0_CLIENT_ID` is public client configuration; the API checks it against the token's authorized-party (`azp`) claim.

HomeSpace assigns every person an internal UUID in `users`. `external_identities` links the Auth0 `(issuer, subject)` pair to that UUID, and project owners, memberships, and upload records refer to the internal UUID. A valid first API request provisions the internal user. This keeps HomeSpace data independent of Auth0's user IDs and allows multiple external identities to be linked later. Identities are not automatically merged by email; account linking needs an explicit, verified flow.

Every project and asset operation checks project membership. A project creator receives the `owner` role. Read access requires membership; upload mutations require `owner` or `editor`. Membership roles are `owner`, `editor`, and `viewer`; role administration will be added with collaboration features. Unauthorized project lookups return `404` to avoid disclosing project existence.

Required environment variables are `DATABASE_URL`, `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`, and `S3_BUCKET`. See `.env.example` for local values and the full configuration list. No development token bypass is included.

## Project and upload flow

1. `POST /projects` creates a project and owner membership in one database transaction.
2. `GET /projects` lists the caller's memberships; `GET /projects/:projectId` reads an authorized project.
3. `POST /projects/:projectId/assets/upload-url` validates the declared type and size, writes a pending asset record, and returns a short-lived signed `POST` policy restricted to the exact declared byte count and content type.
4. The client submits the returned policy fields plus the file in a multipart form directly to private object storage, then calls `POST /assets/:assetId/complete`.
5. The API atomically marks the asset as processing and writes a queued job to PostgreSQL. The worker publishes queued rows to pg-boss and verifies the stored object's content type and byte count.
6. The worker marks the asset available on success or failed on a permanent validation error. `GET /jobs/:jobId` exposes authorized progress; retryable storage errors use pg-boss retries.
7. `GET /projects/:projectId/assets` lists uploads. `GET /assets/:assetId/download-url` returns a short-lived signed `GET` URL after another membership check.

Current supported uploads are JPEG, PNG, WebP, PDF, and MP4. The default maximum is 100 MiB. Browser CORS for the object bucket is restricted to `WEB_ORIGIN`. The API does not expose storage keys or public object URLs.

`GET /projects` and `GET /projects/:projectId/assets` accept `limit` (default 50, maximum 100) and an opaque `cursor`; both return `nextCursor` for the next page.

## Local setup

1. Copy `.env.example` to `.env` and set the Auth0 domain, API audience, and SPA client ID from the Auth0 dashboard.
2. Run `pnpm install` and `docker compose up -d`.
3. Run `pnpm db:migrate`, then `pnpm dev:api` and `pnpm dev:worker` in separate terminals.
4. Send `Authorization: Bearer <access-token>` on protected API requests.

The Compose stack starts PostgreSQL and MinIO. On startup, the API creates the configured bucket if it is missing and applies its browser CORS rule. pg-boss creates its queue schema when the worker starts. The local MinIO console is available at `http://localhost:9001` using the development credentials in `.env.example`.

## Current boundary

This slice does not include the React sign-in UI, Auth0 tenant creation, user invitation, role administration, account linking, plan parsing, media extraction, retention policy, antivirus/content scanning, CI, or the dependency lockfile. The worker currently verifies stored upload metadata; downstream processing should still inspect file contents before using them.
