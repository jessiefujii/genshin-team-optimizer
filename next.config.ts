import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // genshin-db ships ~178 MB of data; load it with Node's require instead of bundling it
  serverExternalPackages: ["genshin-db"],
  partialPrefetching: true,
  // Character icons from Enka's CDN (#179), resized by next/image.
  images: { remotePatterns: [new URL("https://enka.network/ui/**")] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
