import fs from 'fs';
import path from 'path';
import { createGunzip } from 'zlib';
import { extract } from 'tar-stream';
import { TarArchive } from 'archiver';

export function createTarGz(sourceDir: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const archive = new TarArchive({
            gzip: true,
            gzipOptions: { level: 9 }, // Maximum compression ratio
        });
        const stream = fs.createWriteStream(outPath);

        archive
            .directory(sourceDir, false)
            .on('error', reject)
            .pipe(stream);

        stream.on('error', reject);
        stream.on('close', resolve);
        archive.finalize().catch(reject);
    });
}

export function extractTarGz(tarGzPath: string, outDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.mkdirSync(outDir, { recursive: true });

        const parser = extract();
        parser.on('entry', (header, source, next) => {
            const targetPath = path.resolve(outDir, header.name);
            const resolvedOutDir = path.resolve(outDir);

            if (targetPath !== resolvedOutDir && !targetPath.startsWith(`${resolvedOutDir}${path.sep}`)) {
                next(new Error(`Archive entry escapes the output directory: ${header.name}`));
                return;
            }

            if (header.type === 'directory') {
                fs.mkdirSync(targetPath, { recursive: true });
                source.resume();
                source.on('end', () => next());
                return;
            }

            if (header.type === 'file') {
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                const destination = fs.createWriteStream(targetPath);
                source.pipe(destination);
                destination.on('finish', () => next());
                destination.on('error', next);
                return;
            }

            source.resume();
            source.on('end', () => next());
        });
        parser.on('finish', resolve);
        parser.on('error', reject);

        fs.createReadStream(tarGzPath)
            .on('error', reject)
            .pipe(createGunzip())
            .on('error', reject)
            .pipe(parser);
    });
}