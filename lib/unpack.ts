import fs from "fs";
import path from "path";
import { computeSHA256, decryptFile } from "./cryptHelper";
import { extractTarGz } from "./zipHelper";
import { type PackedEventData } from "./types";
import { fileURLToPath } from "url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const PACKED_DIR = path.join(ROOT_DIR, "dist", "data");
const PACKED_LIST_FILE = "dataList.json";

const outputData: PackedEventData[] = JSON.parse(fs.readFileSync(path.join(PACKED_DIR, PACKED_LIST_FILE), "utf-8")) as PackedEventData[];
fs.mkdirSync(PACKED_DIR, { recursive: true });

for (const event of outputData) {
    try {
        const SHA256Hash = await computeSHA256(event.artifactPath);
        const fileSize = fs.statSync(event.artifactPath).size;
        if (SHA256Hash !== event.SHA256 || fileSize !== event.size) {
            console.error(`SHA256 or size mismatch for ${event.artifactPath}. Expected SHA256: ${event.SHA256}, Actual SHA256: ${SHA256Hash}. Expected size: ${event.size}, Actual size: ${fileSize}`);
            continue;
        }

        const tarPath = event.artifactPath.replace(/\.enc$/, "");

        if (event.isEncrypted) {
            await decryptFile(event.artifactPath, tarPath, "cin6open");
            console.log(`Successfully decrypted ${event.artifactPath} to ${tarPath} (${fs.statSync(tarPath).size} bytes)`);
        }

        const extractionDir = path.join(PACKED_DIR, event.dirName);
        await extractTarGz(tarPath, extractionDir);
        console.log(`Successfully extracted ${tarPath} to ${extractionDir} (${fs.statSync(extractionDir).size} bytes)`);
    }
    catch (error) {
        console.error(`Error processing event ${event.eventName}:`, error);
    }
}