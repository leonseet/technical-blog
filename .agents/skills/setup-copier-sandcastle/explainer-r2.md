# Explainer hosting on Cloudflare R2

R2 speaks the S3 API, so the existing `s3` host works — after one code fix. Zero egress fees and a 10 GB free tier make it a good fit for occasional HTML links.

## Patch the ACL first

Copier ships `helpers/explainerHost.mts` with `ACL: "public-read"` hardcoded on the `PutObjectCommand`. R2 rejects `x-amz-acl` outright — every upload fails with `Header 'x-amz-acl' with value 'public-read' not implemented`.

Delete that one line. Public readability on R2 comes from the bucket's public-access setting, not per-object, so nothing replaces it. Leave a comment saying why, or the next template sync invites it back.

Only reintroduce an ACL if the user later moves to real AWS S3, where objects need it to be readable.

## Walk the user through the dashboard

They do all of this in a browser; you wait and collect values.

1. **Create the bucket.** R2 → Create bucket. Any name, Standard class. A payment method is required even on free tier.

2. **Enable public access.** Bucket → Settings → Public access, and note the resulting base URL. Not optional — objects are unreachable over `r2.cloudflarestorage.com`, so without this the loop stores explainers nobody can open.
   - _Custom domain_ — needs the domain on Cloudflare DNS; gets caching and WAF. Prefer this if they have one.
   - _r2.dev subdomain_ — one click, yields `https://pub-<hash>.r2.dev`. Cloudflare rate-limits it and scopes it to development, which is fine for explainer links.

3. **Create the API token.** R2 → API → Manage API tokens → Create API token, permission **Object Read & Write**, scoped to that one bucket. Copy the Access Key ID and Secret Access Key — the secret is shown once — plus the endpoint on the same screen.

## Fill in the knobs

```bash
EXPLAINER_HOST=s3
EXPLAINER_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
EXPLAINER_S3_BUCKET=<bucket>
EXPLAINER_S3_ACCESS_KEY=<access key id>
EXPLAINER_S3_SECRET_KEY=<secret access key>
EXPLAINER_S3_REGION=auto
EXPLAINER_S3_PUBLIC_BASE_URL=<r2.dev or custom domain from step 2>
```

`region=auto` is what Cloudflare's own SDK example uses. `forcePathStyle: true` in the helper stays — R2 accepts path-style addressing.

## If the smoke test fails

- `x-amz-acl … not implemented` — the ACL patch above didn't land.
- `x-amz-checksum-algorithm with value 'CRC32' not implemented` — the January 2025 incompatibility between `@aws-sdk/client-s3` ≥ 3.729 and R2. Cloudflare shipped a server-side fix, so this should not appear; if it does, add `requestChecksumCalculation: "WHEN_REQUIRED"` to the `S3Client` config.
- URL returns 404 while the upload succeeded — public access is off, or `EXPLAINER_S3_PUBLIC_BASE_URL` points somewhere other than the public host.

## Tell the user how keys are shaped

`finalize` keys objects by branch: `<branch>-implementation.html`, flat at the bucket root. Re-running the loop on a branch overwrites its previous explainer. Mention it — it is usually wanted, but it is silent data loss if not.
