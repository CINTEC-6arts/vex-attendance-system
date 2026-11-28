

import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'crypto';
import fs from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { PasswordVerifier } from './types';

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const FILE_MAGIC = Buffer.from('VEXENC1\0');
const HEADER_LENGTH = FILE_MAGIC.length + SALT_LENGTH + IV_LENGTH;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, KEY_LENGTH, (error, key) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(key);
        });
    });
}

export async function encryptFile(
    inputFilePath: string,
    outputFilePath: string,
    password: string,
    binding: string,
): Promise<PasswordVerifier> {
    if (password.length === 0) {
        throw new Error('Encryption password must not be empty.');
    }

    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = await deriveKey(password, salt);
    const verifierIv = randomBytes(IV_LENGTH);
    const verifierCipher = createCipheriv('aes-256-gcm', key, verifierIv);
    verifierCipher.setAAD(Buffer.from(binding, 'utf8'));
    const verifierCiphertext = Buffer.concat([
        verifierCipher.update(`VEX-PASSWORD-CHECK:${binding}`, 'utf8'),
        verifierCipher.final(),
        verifierCipher.getAuthTag(),
    ]);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const output = fs.createWriteStream(outputFilePath);
    const appendAuthTag = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            callback(null, chunk);
        },
        flush(callback) {
            callback(null, cipher.getAuthTag());
        },
    });

    output.write(Buffer.concat([FILE_MAGIC, salt, iv]));
    await pipeline(fs.createReadStream(inputFilePath), cipher, appendAuthTag, output);
    return {
        salt: salt.toString('hex'),
        iv: verifierIv.toString('hex'),
        ciphertext: verifierCiphertext.toString('hex'),
    };
}

export async function decryptFile(
    inputFilePath: string,
    outputFilePath: string,
    password: string,
): Promise<void> {
    if (password.length === 0) {
        throw new Error('Decryption password must not be empty.');
    }

    const inputHandle = await fs.promises.open(inputFilePath, 'r');
    try {
        const { size } = await inputHandle.stat();
        if (size < HEADER_LENGTH + AUTH_TAG_LENGTH) {
            throw new Error('Invalid encrypted file format.');
        }

        const header = Buffer.alloc(HEADER_LENGTH);
        const headerRead = await inputHandle.read(header, 0, HEADER_LENGTH, 0);
        if (headerRead.bytesRead !== HEADER_LENGTH) {
            throw new Error('Invalid encrypted file header.');
        }
        if (!header.subarray(0, FILE_MAGIC.length).equals(FILE_MAGIC)) {
            throw new Error('Invalid file format.');
        }

        const authTag = Buffer.alloc(AUTH_TAG_LENGTH);
        const authTagRead = await inputHandle.read(authTag, 0, AUTH_TAG_LENGTH, size - AUTH_TAG_LENGTH);
        if (authTagRead.bytesRead !== AUTH_TAG_LENGTH) {
            throw new Error('Invalid encrypted file authentication tag.');
        }

        const salt = header.subarray(FILE_MAGIC.length, FILE_MAGIC.length + SALT_LENGTH);
        const iv = header.subarray(FILE_MAGIC.length + SALT_LENGTH, HEADER_LENGTH);
        const key = await deriveKey(password, salt);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);

        const output = fs.createWriteStream(outputFilePath);
        const ciphertextLength = size - HEADER_LENGTH - AUTH_TAG_LENGTH;
        const ciphertext = ciphertextLength === 0
            ? Readable.from([])
            : fs.createReadStream(inputFilePath, {
                start: HEADER_LENGTH,
                end: size - AUTH_TAG_LENGTH - 1,
            });

        try {
            await pipeline(ciphertext, decipher, output);
        } catch (error) {
            await fs.promises.unlink(outputFilePath).catch(() => undefined);
            throw error;
        }
    } finally {
        await inputHandle.close();
    }
}

export async function computeSHA256(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const input = fs.createReadStream(filePath);
    await pipeline(input, hash);
    return hash.digest('hex');
}