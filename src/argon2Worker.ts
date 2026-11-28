import { deriveArgon2Key } from "../lib/argon";

type DeriveMessage = {
    password: string;
    salt: Uint8Array;
};

globalThis.addEventListener("message", async (event: MessageEvent<DeriveMessage>) => {
    try {
        const key = await deriveArgon2Key(event.data.password, event.data.salt);
        globalThis.postMessage({ key }, { transfer: [key.buffer] });
    } catch (error) {
        globalThis.postMessage({
            error: error instanceof Error ? error.message : String(error),
        });
    }
}, { once: true });
