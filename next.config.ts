import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Build output in a ".nosync" folder: the project lives in an iCloud-synced Desktop, and iCloud offloads
  // (makes "dataless") big generated folders, which made builds hang on network reads.
  distDir: ".next.nosync",
  // Pin the project root: a stray ~/package-lock.json made Turbopack treat the whole home folder as the workspace.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
