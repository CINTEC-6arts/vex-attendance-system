import fs from "fs";
import path from "path";
import { createTarGz } from "./zipHelper";
import { computeSHA256, encryptFile } from "./cryptHelper";
import { type UnpackedEventData, type PackedEventData } from "./types";

export async function pack(eventData: UnpackedEventData, UNPACKED_DIR: string, PACKED_DIR: string): Promise<PackedEventData> {
    const eventDirPath = path.join(UNPACKED_DIR, eventData.dirName);
    if (!fs.existsSync(eventDirPath)) { throw new Error(`Directory ${eventDirPath} does not exist.`); }

    fs.mkdirSync(PACKED_DIR, { recursive: true });
    const tarPath = path.join(PACKED_DIR, `${eventData.dirName}.tar.gz`);
    await createTarGz(eventDirPath, tarPath);
    // console.log(`Successfully created ${tarPath} (${fs.statSync(tarPath).size} bytes)`);

    if (eventData.password) {
        const encryptedPath = `${tarPath}.enc`;
        await encryptFile(tarPath, encryptedPath, eventData.password);
        // console.log(`Successfully encrypted ${tarPath} to ${encryptedPath} (${fs.statSync(encryptedPath).size} bytes)`);

        fs.unlinkSync(tarPath);
        // console.log(`Deleted original tar.gz file: ${tarPath}`);
    }

    const sha256Hash = await computeSHA256(eventData.password ? `${tarPath}.enc` : tarPath);

    return {
        eventName: eventData.eventName,
        dirName: eventData.dirName,
        artifactPath: path.basename(eventData.password ? `${tarPath}.enc` : tarPath),
        isEncrypted: !!eventData.password,
        SHA256: sha256Hash,
        size: fs.statSync(eventData.password ? `${tarPath}.enc` : tarPath).size,
    };
}