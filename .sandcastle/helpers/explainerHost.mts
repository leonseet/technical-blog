// The explainer-hosting seam: finalize hands a written HTML file to whichever
// host the consuming repo configured and gets back a permanent URL. Mirrors
// the issue-tracker seam: one contract, a factory that resolves configuration,
// implementations behind it. Null when unconfigured — the caller degrades
// best-effort, never fails the run.
//
//   import { createExplainerHost } from "../helpers/explainerHost.mts";

import { readFileSync } from "node:fs";
import { Agent } from "node:https";
import { join } from "node:path";
import { parseEnv } from "node:util";

export type ExplainerHost = {
  /** Upload `file` (HTML) as `key` and return its permanent public URL.
   *  Throws on any failure; the caller degrades. */
  publish(file: string, key: string): Promise<string>;
};

/** `EXPLAINER_*` from the real environment first, then `.sandcastle/.env` (the
 *  loop's own process never receives the file sandcastle injects into
 *  sandboxes). */
function explainerEnv(
  root: string,
  env: NodeJS.ProcessEnv,
): (key: string) => string | undefined {
  let file: NodeJS.Dict<string> = {};
  try {
    file = parseEnv(readFileSync(join(root, ".sandcastle", ".env"), "utf8"));
  } catch {
    // No project env file: environment variables are the only source.
  }
  return (key: string) => env[key] || file[key];
}

function s3Host(get: (key: string) => string | undefined): ExplainerHost {
  const required = {
    EXPLAINER_S3_ENDPOINT: get("EXPLAINER_S3_ENDPOINT"),
    EXPLAINER_S3_BUCKET: get("EXPLAINER_S3_BUCKET"),
    EXPLAINER_S3_ACCESS_KEY: get("EXPLAINER_S3_ACCESS_KEY"),
    EXPLAINER_S3_SECRET_KEY: get("EXPLAINER_S3_SECRET_KEY"),
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`EXPLAINER_HOST=s3 but missing: ${missing.join(", ")}`);
  }
  const endpoint = required.EXPLAINER_S3_ENDPOINT!.replace(/\/+$/, "");
  const bucket = required.EXPLAINER_S3_BUCKET!;
  const caBundle = get("EXPLAINER_S3_CA_BUNDLE");
  const publicBase = get("EXPLAINER_S3_PUBLIC_BASE_URL")?.replace(/\/+$/, "");

  return {
    async publish(file: string, key: string): Promise<string> {
      // Deferred so a run that never uploads pays nothing for the SDK.
      const [{ S3Client, PutObjectCommand }, { NodeHttpHandler }] =
        await Promise.all([
          import("@aws-sdk/client-s3"),
          import("@smithy/node-http-handler"),
        ]);
      const client = new S3Client({
        endpoint,
        // Ceph/MinIO-style endpoints serve buckets by path, not subdomain.
        forcePathStyle: true,
        region: get("EXPLAINER_S3_REGION") || "us-east-1",
        credentials: {
          accessKeyId: required.EXPLAINER_S3_ACCESS_KEY!,
          secretAccessKey: required.EXPLAINER_S3_SECRET_KEY!,
        },
        ...(caBundle
          ? {
              requestHandler: new NodeHttpHandler({
                httpsAgent: new Agent({ ca: readFileSync(caBundle) }),
              }),
            }
          : {}),
      });
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: readFileSync(file),
            ContentType: "text/html",
            ACL: "public-read",
          }),
        );
      } finally {
        client.destroy();
      }
      return publicBase
        ? `${publicBase}/${key}`
        : `${endpoint}/${bucket}/${key}`;
    },
  };
}

/** Resolve the explainer host for the repo rooted at `root`. Null when
 *  `EXPLAINER_HOST` is unset — hosting is optional and finalize degrades. An
 *  unknown or half-configured host throws: the repo asked for hosting and
 *  should hear that it is broken, not silently lose its links. */
export function createExplainerHost(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): ExplainerHost | null {
  const get = explainerEnv(root, env);
  const host = get("EXPLAINER_HOST")?.trim().toLowerCase();
  if (!host) return null;
  if (host === "s3") return s3Host(get);
  throw new Error(`unknown EXPLAINER_HOST "${host}"; supported: s3`);
}
