// Smoke test for the explainer-hosting seam: publish a throwaway HTML file,
// fetch it back, then delete it. Leaves the bucket as it found it.
//
// Copy into .sandcastle/ and run from there — it needs that package's
// node_modules to resolve the S3 SDK:
//
//   cp .claude/skills/setup-copier-sandcastle/scripts/smoke.mts .sandcastle/.smoke.tmp.mts
//   (cd .sandcastle && npx tsx .smoke.tmp.mts); rm .sandcastle/.smoke.tmp.mts
//
// `npx tsx -e` will not work: -e is compiled as CJS and rejects top-level await.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createExplainerHost } from "./helpers/explainerHost.mts";

const sandcastle = import.meta.dirname;
const root = dirname(sandcastle);
const KEY = "smoke-test.html";

const host = createExplainerHost(root);
if (!host) throw new Error("EXPLAINER_HOST is unset in .sandcastle/.env");

const file = join(sandcastle, ".smoke-test.html");
writeFileSync(file, "<h1>hello from sandcastle</h1>\n");

let url: string;
try {
  url = await host.publish(file, KEY);
  console.log(`published: ${url}`);

  const res = await fetch(url);
  const type = res.headers.get("content-type");
  console.log(`fetched:   ${res.status} ${type}`);
  if (!res.ok) throw new Error("published object is not publicly readable");
  if (!type?.startsWith("text/html")) {
    throw new Error(`expected text/html, got ${type} — explainers will download`);
  }
} finally {
  unlinkSync(file);
}

// Clean up: the bucket is the user's, and a stray test object is litter.
const env = parseEnv(readFileSync(join(sandcastle, ".env"), "utf8"));
const get = (k: string) => process.env[k] || env[k];
const client = new S3Client({
  endpoint: get("EXPLAINER_S3_ENDPOINT")!.replace(/\/+$/, ""),
  forcePathStyle: true,
  region: get("EXPLAINER_S3_REGION") || "us-east-1",
  credentials: {
    accessKeyId: get("EXPLAINER_S3_ACCESS_KEY")!,
    secretAccessKey: get("EXPLAINER_S3_SECRET_KEY")!,
  },
});
try {
  await client.send(
    new DeleteObjectCommand({ Bucket: get("EXPLAINER_S3_BUCKET")!, Key: KEY }),
  );
} finally {
  client.destroy();
}
console.log(`deleted:   ${(await fetch(url)).status} (expect 404)`);
