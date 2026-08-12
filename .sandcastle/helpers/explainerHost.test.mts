import assert from "node:assert/strict";
import { test } from "vitest";

import { createExplainerHost } from "./explainerHost.mts";

// No .sandcastle/.env under this root, so the passed env is the only source.
const ROOT = "/nonexistent";

test("unconfigured hosting resolves to null so finalize degrades", () => {
  assert.equal(createExplainerHost(ROOT, {}), null);
  assert.equal(createExplainerHost(ROOT, { EXPLAINER_HOST: "" }), null);
});

test("an unknown host fails loudly rather than losing links silently", () => {
  assert.throws(
    () => createExplainerHost(ROOT, { EXPLAINER_HOST: "gopher" }),
    /unknown EXPLAINER_HOST "gopher"/,
  );
});

test("a half-configured s3 host names exactly what is missing", () => {
  assert.throws(
    () =>
      createExplainerHost(ROOT, {
        EXPLAINER_HOST: "s3",
        EXPLAINER_S3_ENDPOINT: "https://s3.example.com",
        EXPLAINER_S3_BUCKET: "explainers",
      }),
    /missing: EXPLAINER_S3_ACCESS_KEY, EXPLAINER_S3_SECRET_KEY/,
  );
});

test("a fully configured s3 host resolves", () => {
  const host = createExplainerHost(ROOT, {
    EXPLAINER_HOST: "S3",
    EXPLAINER_S3_ENDPOINT: "https://s3.example.com/",
    EXPLAINER_S3_BUCKET: "explainers",
    EXPLAINER_S3_ACCESS_KEY: "key",
    EXPLAINER_S3_SECRET_KEY: "secret",
  });
  assert.ok(host);
  assert.equal(typeof host.publish, "function");
});
