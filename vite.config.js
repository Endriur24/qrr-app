//Its used for client side
import { defineConfig } from "vite";

export default defineConfig(() => {
    return {
      esbuild: {
        jsxImportSource: "hono/jsx/dom",
      },
      build: {
        // Don't wipe dist/ – Eleventy output lives there too
        emptyOutDir: false,
        rollupOptions: {
          input: "./src/client.tsx",
          watch: {
            include: "src/client.tsx",
          },
          output: {
            entryFileNames: "static/client.js",
          },
        },
      },
    };
});
