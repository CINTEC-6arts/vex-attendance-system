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

function fromHex(value: string, expectedLength?: number): Uint8Array<ArrayBuffer> {
    if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error("Invalid password verifier encoding.");
    const bytes = ownedBytes(value.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)));
    if (expectedLength !== undefined && bytes.length !== expectedLength) {
        throw new Error("Invalid password verifier length.");
    }
    return bytes;
}

async function deriveKey(
    password: string,
    salt: Uint8Array<ArrayBuffer>,
    onProgress?: (progress: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
    const passwordBytes = new TextEncoder().encode(password);
    return ownedBytes(await scrypt(passwordBytes, salt, 16384, 8, 1, 32, onProgress));
}

async function verifyPassword(
    event: PackedEventData,
    password: string,
    onProgress?: (progress: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
    const verifier = event.passwordVerifier;
    if (!verifier) throw new Error(`Password verifier is missing for ${event.eventName}.`);
    const salt = fromHex(verifier.salt, 16);
    const iv = fromHex(verifier.iv, 12);
    const encryptedPhrase = fromHex(verifier.ciphertext);
    if (encryptedPhrase.length < 16) throw new Error("Invalid password verifier ciphertext.");
    const keyBytes = await deriveKey(password, salt, onProgress);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    try {
        const plaintext = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(event.dirName) },
            key,
            encryptedPhrase,
        );
        if (new TextDecoder().decode(plaintext) !== `VEX-PASSWORD-CHECK:${event.dirName}`) {
            throw new WrongPasswordError(event.eventName);
        }
    } catch {
        throw new WrongPasswordError(event.eventName);
    }
    return keyBytes;
}

async function readArchive(
    response: Response,
    event: PackedEventData,
    onProgress?: (progress: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
    if (!response.body) {
        const bytes = ownedBytes(new Uint8Array(await response.arrayBuffer()));
        onProgress?.(1);
        return bytes;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        chunks.push(value);
        onProgress?.(Math.min(received / event.size, 1));
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return ownedBytes(bytes);
}

async function decryptPackedFile(
    bytes: Uint8Array,
    event: PackedEventData,
    keyBytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
    if (bytes.length < 52) throw new Error("Invalid encrypted archive.");
    if (new TextDecoder().decode(bytes.slice(0, 8)) !== "VEXENC1\u0000") {
        throw new Error("Invalid encrypted archive format.");
    }
    if (!event.passwordVerifier || hex(bytes.slice(8, 24)) !== event.passwordVerifier.salt) {
        throw new Error("Archive encryption salt does not match its password verifier.");
    }

    const iv = ownedBytes(bytes.slice(24, 36));
    const authTag = ownedBytes(bytes.slice(-16));
    const ciphertext = ownedBytes(bytes.slice(36, -16));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const combined = ownedBytes([...ciphertext, ...authTag]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
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
    fetchArchive: (url: string, signal?: AbortSignal) => Promise<Response>,
    getPassword?: (event: PackedEventData) => string | null | Promise<string | null>,
    onPasswordCheckProgress?: (progress: number) => void,
    onArchiveDownloadProgress?: (progress: number) => void,
): Promise<PackedEventFiles> {
    let archiveBytes: Uint8Array<ArrayBuffer>;
    let keyBytes: Uint8Array<ArrayBuffer> | undefined;
    if (event.isEncrypted) {
        const password = await getPassword?.(event);
        if (password === null) throw new PasswordCancelledError();
        if (!password) throw new WrongPasswordError(event.eventName);

        const controller = new AbortController();
        const archivePromise = fetchArchive(
            `data/${encodeURIComponent(event.artifactPath)}`,
            controller.signal,
        ).then((response) => readArchive(response, event, onArchiveDownloadProgress));
        const archiveOutcome = archivePromise.then(
            (bytes) => ({ bytes }),
            (error: unknown) => ({ error }),
        );
        try {
            keyBytes = await verifyPassword(event, password, onPasswordCheckProgress);
        } catch (error) {
            controller.abort();
            await archiveOutcome;
            throw error;
        }
        const outcome = await archiveOutcome;
        if ("error" in outcome) throw outcome.error;
        archiveBytes = outcome.bytes;
    } else {
        const response = await fetchArchive(`data/${encodeURIComponent(event.artifactPath)}`);
        archiveBytes = await readArchive(response, event, onArchiveDownloadProgress);
    }

    if (archiveBytes.byteLength !== event.size) {
        throw new Error(`Archive size mismatch for ${event.eventName}.`);
    }
    if (await sha256(archiveBytes) !== event.SHA256) {
        throw new Error(`Archive SHA-256 mismatch for ${event.eventName}.`);
    }

    let tarBytes: Uint8Array<ArrayBuffer>;
    if (event.isEncrypted) {
        if (!keyBytes) throw new Error(`Encryption key was not derived for ${event.eventName}.`);
        tarBytes = await decryptPackedFile(archiveBytes, event, keyBytes);
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
