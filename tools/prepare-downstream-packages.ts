import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface PackageManifest {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const root = resolve(import.meta.dirname, '..');
const packages = [
  { source: 'libs/grid', dist: 'dist/libs/grid', upstreamName: '@toolbox-web/grid' },
  {
    source: 'libs/grid-react',
    dist: 'dist/libs/grid-react',
    upstreamName: '@toolbox-web/grid-react',
  },
];

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as PackageManifest;
}

for (const { source, dist, upstreamName } of packages) {
  const sourceManifest = await readManifest(`${source}/package.json`);
  const romaManifest = await readManifest(`${source}/package.roma.json`);
  if (sourceManifest.name !== upstreamName) {
    throw new Error(`${source}/package.json must retain upstream identity ${upstreamName}`);
  }
  if (!romaManifest.version.startsWith(`${sourceManifest.version}-roma.`)) {
    throw new Error(
      `${source}/package.roma.json version ${romaManifest.version} must derive from upstream ${sourceManifest.version}`,
    );
  }

  const distPath = resolve(root, dist, 'package.json');
  const distManifest = await readManifest(`${dist}/package.json`);
  await writeFile(distPath, `${JSON.stringify({ ...distManifest, ...romaManifest }, null, 2)}\n`);
}

const gridManifest = await readManifest('dist/libs/grid/package.json');
const reactManifest = await readManifest('dist/libs/grid-react/package.json');
if (!reactManifest.peerDependencies?.['@toolbox-web/grid']) {
  throw new Error('Roma React package must retain the @toolbox-web/grid peer for npm aliases');
}
reactManifest.peerDependencies['@toolbox-web/grid'] = gridManifest.version;
await writeFile(resolve(root, 'dist/libs/grid-react/package.json'), `${JSON.stringify(reactManifest, null, 2)}\n`);
if (reactManifest.peerDependencies['@toolbox-web/grid'] !== gridManifest.version) {
  throw new Error('Roma React peer must exactly match the paired downstream grid prerelease');
}

console.log('Prepared @etokheim Roma package manifests in dist.');
