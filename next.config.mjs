import createMDX from "@next/mdx";

/** @type {import("next").NextConfig} */
const nextConfig = {
  agentRules: false,
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
};

const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
    rehypePlugins: [
      [
        "rehype-pretty-code",
        {
          theme: {
            dark: "github-dark",
            light: "github-light",
          },
        },
      ],
      "rehype-slug",
      ["rehype-autolink-headings", { behavior: "prepend" }],
    ],
  },
});

export default withMDX(nextConfig);
