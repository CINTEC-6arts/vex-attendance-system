export type UnpackedEventData = {
    eventName: string;
    dirName: string;
    password: string | null;
};
export type PasswordVerifier = {
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