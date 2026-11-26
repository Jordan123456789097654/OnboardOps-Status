// Starts the bot. Hosts that run "node index.js" use this file; it loads the TypeScript source through tsx.
import { tsImport } from "tsx/esm/api";

await tsImport("./src/index.ts", import.meta.url);
