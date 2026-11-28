export type UnpackedEventData = {
    eventName: string;
    dirName: string;
    password: string | null;
};
export type PasswordVerifier = {
    algorithm: "argon2d";
    memoryKiB: number;
    iterations: number;
    parallelism: number;
    salt: string;
    iv: string;
    ciphertext: string;
};
export type PackedEventData = {
    eventName: string;
    dirName: string;
    artifactPath: string;
    isEncrypted: boolean;
    SHA256: string;
    size: number;
    passwordVerifier?: PasswordVerifier;
};