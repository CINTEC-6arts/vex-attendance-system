import { mkdir, readdir, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const events = (await readdir("assets", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
await writeFile("dist/events.txt", events.join("\n") + (events.length ? "\n" : ""), "utf8");
