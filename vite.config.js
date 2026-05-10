//Its used for client side
import { defineConfig } from "vite";

export default defineConfig(() => {
    return {
      esbuild: {
        jsxImportSource: "hono/jsx/dom",
      },
      build: {
        rollupOptions: {
          input: "./src/client.tsx",
          emptyOutDir: false,
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
