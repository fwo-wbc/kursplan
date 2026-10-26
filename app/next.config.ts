import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Standalone-Output für das Container-Deployment:
   * erzeugt bei `next build` das Verzeichnis .next/standalone mit eigenem
   * Node-Server (server.js) inkl. der minimal benötigten node_modules.
   */
  output: "standalone",
};

export default nextConfig;
