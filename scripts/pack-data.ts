import fs from "fs";
import { PackedEventData, UnpackedEventData } from "../lib/types";
import path from "path";
import { fileURLToPath } from "url";
import { pack } from "../lib/pack";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const UNPACKED_DIR = path.join(ROOT_DIR, "vex-attendance-system-data");
const PACKED_DIR = path.join(ROOT_DIR, "dist", "data");
const unpackedEventDataList = require(path.join(UNPACKED_DIR, "dataList.json")) as UnpackedEventData[];

fs.mkdirSync(PACKED_DIR, { recursive: true });

const packedEventDataList: PackedEventData[] =
    (await Promise.all(
        unpackedEventDataList
            .map(async (eventData) =>
                pack(eventData, UNPACKED_DIR, PACKED_DIR)
                    .then((packedData) => {
                        console.log(`Packed ${packedData.artifactPath} (${packedData.size} bytes)`);
                        return packedData;
                    })
                    .catch(error => { console.error(`Error packing event ${eventData.eventName}:`, error); })
            )
    )).filter((packedData): packedData is PackedEventData => packedData !== null);

fs.writeFileSync(path.join(PACKED_DIR, "dataList.json"), JSON.stringify(packedEventDataList, null, 4));