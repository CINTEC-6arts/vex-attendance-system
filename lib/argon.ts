import { argon2d } from "hash-wasm";

export const ARGON2_ALGORITHM = "argon2d" as const;
export const ARGON2_MEMORY_KIB = 65536;
export const ARGON2_ITERATIONS = 3;
export const ARGON2_PARALLELISM = 1;
export const ARGON2_KEY_LENGTH = 32;

export async function deriveArgon2Key(password: string, salt: Uint8Array): Promise<Uint8Array> {
    return argon2d({
        password,
        salt,
        parallelism: ARGON2_PARALLELISM,
        iterations: ARGON2_ITERATIONS,
        memorySize: ARGON2_MEMORY_KIB,
        hashLength: ARGON2_KEY_LENGTH,
        outputType: "binary",
    });
}
