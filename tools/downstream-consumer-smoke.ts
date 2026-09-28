import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

interface RegistryPackage {
  manifest: Record<string, unknown> & { name: string; version: string };
  tarball: Buffer;
  shasum: string;
  integrity: string;
}

const root = resolve(import.meta.dirname, '..');
const packages = [
  { dist: 'dist/libs/grid', expectedName: '@etokheim/toolbox-grid' },
  { dist: 'dist/libs/grid-react', expectedName: '@etokheim/toolbox-grid-react' },
];

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  const [code] = (await once(child, 'close')) as [number];
  if (code !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${code}`);
  return stdout.trim();
}

async function packPackages(temp: string): Promise<Map<string, RegistryPackage>> {
  const registry = new Map<string, RegistryPackage>();
  for (const { dist, expectedName } of packages) {
    const packageRoot = resolve(root, dist);
    const manifest = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    ) as RegistryPackage['manifest'];
    if (manifest.name !== expectedName) {
      throw new Error(`${dist} contains ${manifest.name}; expected ${expectedName}`);
    }

    const output = await run('npm', ['pack', '--silent', '--pack-destination', temp, packageRoot], root);
    const tarballPath = join(temp, output.split('\n').at(-1) ?? '');
    const tarball = await readFile(tarballPath);
    registry.set(manifest.name, {
      manifest,
      tarball,
      shasum: createHash('sha1').update(tarball).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
    });
  }
  return registry;
}

async function startRegistry(registry: Map<string, RegistryPackage>): Promise<{
  server: Server;
  baseUrl: string;
}> {
  let baseUrl = '';
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const packageName = Array.from(registry.keys()).find((name) => path === `/${name}`);
    if (packageName) {
      const item = registry.get(packageName)!;
      const tarballName = `${packageName.slice(packageName.indexOf('/') + 1)}-${item.manifest.version}.tgz`;
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          name: packageName,
          'dist-tags': { roma: item.manifest.version },
          versions: {
            [item.manifest.version]: {
              ...item.manifest,
              dist: {
                tarball: `${baseUrl}/${packageName}/-/${tarballName}`,
                shasum: item.shasum,
                integrity: item.integrity,
              },
            },
          },
        }),
      );
      return;
    }

    const tarballPackage = Array.from(registry.keys()).find((name) => path.startsWith(`/${name}/-/`));
    if (tarballPackage) {
      response.setHeader('content-type', 'application/octet-stream');
      response.end(registry.get(tarballPackage)!.tarball);
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local registry did not bind a port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, baseUrl };
}

async function main(): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), 'toolbox-roma-smoke-'));
  let server: Server | undefined;
  try {
    const registry = await packPackages(temp);
    const started = await startRegistry(registry);
    server = started.server;

    const consumer = join(temp, 'consumer');
    await mkdir(consumer);
    const gridVersion = registry.get('@etokheim/toolbox-grid')!.manifest.version;
    const reactVersion = registry.get('@etokheim/toolbox-grid-react')!.manifest.version;
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify(
        {
          name: 'roma-alias-smoke',
          private: true,
          dependencies: {
            '@toolbox-web/grid': `npm:@etokheim/toolbox-grid@${gridVersion}`,
            '@toolbox-web/grid-react': `npm:@etokheim/toolbox-grid-react@${reactVersion}`,
            react: `file:${resolve(root, 'node_modules/react')}`,
            'react-dom': `file:${resolve(root, 'node_modules/react-dom')}`,
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(consumer, '.npmrc'),
      `@etokheim:registry=${started.baseUrl}/\nregistry=https://registry.npmjs.org/\n`,
    );
    await run('bun', ['install', '--ignore-scripts', '--no-progress'], consumer);

    const gridPackagePath = join(consumer, 'node_modules/@toolbox-web/grid/package.json');
    const reactPackagePath = join(consumer, 'node_modules/@toolbox-web/grid-react/package.json');
    const installedGrid = JSON.parse(await readFile(gridPackagePath, 'utf8')) as { name: string };
    const installedReact = JSON.parse(await readFile(reactPackagePath, 'utf8')) as { name: string };
    if (installedGrid.name !== '@etokheim/toolbox-grid') throw new Error('Grid alias was not installed');
    if (installedReact.name !== '@etokheim/toolbox-grid-react') {
      throw new Error('React alias was not installed');
    }

    const consumerGrid = await realpath(Bun.resolveSync('@toolbox-web/grid', consumer).replace(/\/index\.js$/, ''));
    const reactGrid = await realpath(
      Bun.resolveSync('@toolbox-web/grid', dirname(reactPackagePath)).replace(/\/index\.js$/, ''),
    );
    if (consumerGrid !== reactGrid) {
      throw new Error(`React resolved a duplicate grid copy:\n${consumerGrid}\n${reactGrid}`);
    }

    const manifests = Array.from(
      new Bun.Glob('node_modules/**/package.json').scanSync({ cwd: consumer, absolute: true }),
    );
    let gridCopies = 0;
    for (const manifestPath of manifests) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: string };
      if (manifest.name === '@etokheim/toolbox-grid') gridCopies++;
    }
    if (gridCopies !== 1) throw new Error(`Expected one downstream grid copy, found ${gridCopies}`);

    console.log('Roma aliases resolve @toolbox-web/grid and @toolbox-web/grid-react with one grid copy.');
  } finally {
    if (server) {
      server.close();
      await once(server, 'close');
    }
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
