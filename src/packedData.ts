import { gunzipSync } from "fflate";
import { scrypt } from "scrypt-js";
import type { PackedEventData } from "../lib/types";

export type PackedEventFiles = Map<string, Blob>;

export class PasswordCancelledError extends Error {
    constructor() {
        super("Password entry was cancelled.");
        this.name = "PasswordCancelledError";
    }
}

export class WrongPasswordError extends Error {
    constructor(eventName: string) {
        super(`The password for ${eventName} is incorrect.`);
        this.name = "WrongPasswordError";
    }
}

function ownedBytes(bytes: ArrayLike<number>): Uint8Array<ArrayBuffer> {
    const owned = new Uint8Array(bytes.length);
    owned.set(Uint8Array.from(bytes));
    return owned;
}

function hex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const owned = ownedBytes(bytes);
    const digest = await crypto.subtle.digest("SHA-256", owned);
    return hex(new Uint8Array(digest));
}

async function decryptPackedFile(bytes: Uint8Array, password: string, eventName: string): Promise<Uint8Array<ArrayBuffer>> {
    if (bytes.length < 52) throw new Error("Invalid encrypted archive.");
    const magic = new TextDecoder().decode(bytes.slice(0, 8));
    if (magic !== "VEXENC1\u0000") throw new Error("Invalid encrypted archive format.");

    const salt = ownedBytes(bytes.slice(8, 24));
    const iv = ownedBytes(bytes.slice(24, 36));
    const authTag = ownedBytes(bytes.slice(-16));
    const ciphertext = ownedBytes(bytes.slice(36, -16));
    const passwordBytes = new TextEncoder().encode(password);
    const keyBytes = ownedBytes(await scrypt(passwordBytes, salt, 16384, 8, 1, 32));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const combined = ownedBytes([...ciphertext, ...authTag]);
    let plaintext: ArrayBuffer;
    try {
        plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            combined,
        );
    } catch {
        throw new WrongPasswordError(eventName);
    }
    return new Uint8Array(plaintext);
}

function parseTar(tarBytes: Uint8Array): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    let offset = 0;
    while (offset + 512 <= tarBytes.length) {
        const header = tarBytes.slice(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;

        const decodeString = (start: number, length: number): string => {
            const end = header.indexOf(0, start);
            const limit = start + length;
            return new TextDecoder().decode(header.slice(start, end >= start && end < limit ? end : limit));
        };
        const name = decodeString(0, 100);
        const prefix = decodeString(345, 155);
        const size = parseInt(decodeString(124, 12).trim(), 8) || 0;
        const type = header[156];
        offset += 512;

        const pathName = prefix ? `${prefix}/${name}` : name;
        if (type === 0 || type === 48) {
            files.set(pathName.replace(/^\/+/, ""), tarBytes.slice(offset, offset + size));
        }
        offset += Math.ceil(size / 512) * 512;
    }
    return files;
}

export async function loadPackedEvent(
    event: PackedEventData,
    fetchArchive: (url: string) => Promise<Response>,
    getPassword?: (event: PackedEventData) => string | null,
): Promise<PackedEventFiles> {
    const archiveResponse = await fetchArchive(`data/${encodeURIComponent(event.artifactPath)}`);
    const archiveBytes = ownedBytes(new Uint8Array(await archiveResponse.arrayBuffer()));
    if (archiveBytes.byteLength !== event.size) {
        throw new Error(`Archive size mismatch for ${event.eventName}.`);
    }
    if (await sha256(archiveBytes) !== event.SHA256) {
        throw new Error(`Archive SHA-256 mismatch for ${event.eventName}.`);
    }

    let tarBytes: Uint8Array<ArrayBuffer>;
    if (event.isEncrypted) {
        const password = getPassword?.(event);
        if (password === null) throw new PasswordCancelledError();
        if (!password) throw new WrongPasswordError(event.eventName);
        tarBytes = await decryptPackedFile(archiveBytes, password, event.eventName);
    } else {
        tarBytes = archiveBytes;
    }

    const tar = gunzipSync(tarBytes);
    const files = parseTar(tar);
    return new Map([...files].map(([fileName, bytes]) => {
        const mimeType = fileName.endsWith(".csv")
            ? "text/csv"
            : fileName.match(/\.(png|jpe?g|gif|webp)$/i)
                ? "image/*"
                : "application/octet-stream";
        const owned: Uint8Array<ArrayBuffer> = new Uint8Array(bytes.byteLength);
        owned.set(bytes);
        return [fileName, new Blob([owned.buffer], { type: mimeType })];
    }));
}
