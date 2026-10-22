import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

export interface BundleSize {
  path: string;
  raw: number;
  gzip: number;
}

export interface BundleMeasurements {
  bunVersion: string;
  files: BundleSize[];
}

function validateMeasurements(value: unknown, paths: string[]): BundleMeasurements {
  if (
    !value ||
    typeof value !== 'object' ||
    !('bunVersion' in value) ||
    typeof value.bunVersion !== 'string' ||
    !value.bunVersion ||
    !('files' in value) ||
    !Array.isArray(value.files) ||
    value.files.length !== paths.length
  ) {
    throw new Error('Invalid Bun bundle measurement response');
  }
  const files: BundleSize[] = value.files.map((file: unknown, index) => {
    if (
      !file ||
      typeof file !== 'object' ||
      !('path' in file) ||
      file.path !== paths[index] ||
      !('raw' in file) ||
      typeof file.raw !== 'number' ||
      !Number.isSafeInteger(file.raw) ||
      file.raw < 0 ||
      !('gzip' in file) ||
      typeof file.gzip !== 'number' ||
      !Number.isSafeInteger(file.gzip) ||
      file.gzip <= 0
    ) {
      throw new Error(`Invalid Bun bundle measurement for ${paths[index]}`);
    }
    return { path: paths[index], raw: file.raw, gzip: file.gzip };
  });
  return { bunVersion: value.bunVersion, files };
}

/** Bun's default node:zlib gzip is the authority, regardless of the calling runtime. */
export function measureBundles(paths: string[]): BundleMeasurements {
  if (process.versions.bun) {
    return {
      bunVersion: process.versions.bun,
      files: paths.map((path) => {
        const content = readFileSync(path);
        return { path, raw: content.length, gzip: gzipSync(content).length };
      }),
    };
  }

  // One batch per check/report. Never substitute Node's compressor if Bun fails.
  const output = execFileSync('bun', [fileURLToPath(import.meta.url), '--worker'], {
    input: JSON.stringify(paths),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return validateMeasurements(JSON.parse(output), paths);
}

if (process.argv[2] === '--worker') {
  if (!process.versions.bun) throw new Error('Bundle measurement worker must run under Bun');
  const paths: unknown = JSON.parse(readFileSync(0, 'utf8'));
  if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === 'string')) {
    throw new Error('Bundle measurement worker expects an array of file paths');
  }
  console.log(JSON.stringify(measureBundles(paths)));
}
