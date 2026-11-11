import { cp } from "node:fs/promises";

await cp("assets", "dist/assets", { recursive: true });
