export type UnpackedEventData = {
    eventName: string;
    dirName: string;
    password: string | null;
};
export type PackedEventData = {
    eventName: string;
    dirName: string;
    artifactPath: string;
    isEncrypted: boolean;
    SHA256: string;
    size: number;
};