/**
 * Builds and signs a catalog release.
 *
 * Deliberately self-contained: no dependencies, no build step, and no reference
 * to the Groundplan application source. A data repository that needs an
 * application checked out beside it to publish is a data repository that stops
 * being publishable the moment the application moves.
 *
 *   node build.mjs 1.1.0
 *
 * The signing key comes from CATALOG_SIGNING_KEY, which CI supplies as a
 * secret. It is never committed and never printed.
 */

import { createHash, sign as cryptoSign } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: node build.mjs <version>   e.g. node build.mjs 1.1.0');
  process.exit(1);
}

const privateKey = process.env.CATALOG_SIGNING_KEY;
if (!privateKey) {
  console.error('CATALOG_SIGNING_KEY is not set.');
  process.exit(1);
}

const BASE_URL = `https://github.com/kxd21/groundplan-catalog/releases/download/v${version}`;
const OUT = 'dist';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Keys sorted at every level, so identical content always signs identically. */
function canonicalise(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([k, v]) => k !== 'signature' && v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}

const compareVersions = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  return 0;
};

// --- load and check --------------------------------------------------------

const products = JSON.parse(readFileSync('products.json', 'utf8'));
if (!Array.isArray(products)) {
  console.error('products.json must be an array');
  process.exit(1);
}

const ids = new Set();
for (const product of products) {
  if (!product?.id || !product.name || !product.category) {
    console.error(`a product is missing id, name or category: ${JSON.stringify(product).slice(0, 120)}`);
    process.exit(1);
  }
  if (ids.has(product.id)) {
    console.error(`duplicate product id: ${product.id}`);
    process.exit(1);
  }
  ids.add(product.id);

  // An icon is geometry. Any string inside one means something textual — a
  // label, a room, a client — survived into a file everybody downloads. This is
  // the last gate before publication, so it refuses rather than warns.
  if (product.icon) {
    const stack = [product.icon];
    while (stack.length) {
      const value = stack.pop();
      if (Array.isArray(value)) stack.push(...value);
      else if (value && typeof value === 'object') stack.push(...Object.values(value));
      else if (typeof value === 'string') {
        console.error(`refusing to publish: the icon for ${product.id} contains text ("${value}")`);
        process.exit(1);
      }
    }
  }
}

const catalog = {
  format: 'groundplan-catalog',
  meta: {
    version,
    schemaVersion: 1,
    released: new Date().toISOString(),
    minAppVersion: '1.0.0',
    productCount: products.length,
  },
  products: [...products].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
};

// --- packages --------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const write = (name, value) => {
  const body = JSON.stringify(value);
  writeFileSync(join(OUT, name), body, 'utf8');
  return { url: `${BASE_URL}/${name}`, bytes: Buffer.byteLength(body), sha256: sha256(body) };
};

const full = write('full.json', catalog);

/** Records changed by value, so an unchanged one never enters a delta. */
function computeDelta(from, to) {
  const before = new Map(from.products.map((p) => [p.id, p]));
  const after = new Map(to.products.map((p) => [p.id, p]));
  const upsert = to.products.filter((p) => JSON.stringify(before.get(p.id)) !== JSON.stringify(p));
  const deprecate = from.products
    .filter((p) => after.get(p.id)?.deprecated && !p.deprecated)
    .map((p) => ({ id: p.id, replacedBy: after.get(p.id).replacedBy, reason: after.get(p.id).deprecated.reason }));
  return {
    format: 'groundplan-catalog-delta',
    fromVersion: from.meta.version,
    toVersion: to.meta.version,
    upsert,
    deprecate,
    delete: from.products.filter((p) => !after.has(p.id)).map((p) => p.id),
    meta: to.meta,
  };
}

const deltas = {};
let counts = { added: products.length, updated: 0, deprecated: 0 };

if (existsSync('releases')) {
  const earlier = readdirSync('releases')
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join('releases', f), 'utf8')))
    .filter((c) => compareVersions(c.meta.version, version) < 0)
    .sort((a, b) => compareVersions(b.meta.version, a.meta.version));

  for (const previous of earlier) {
    const delta = computeDelta(previous, catalog);
    deltas[previous.meta.version] = write(`from-${previous.meta.version}.json`, delta);
    if (previous === earlier[0]) {
      const had = new Set(previous.products.map((p) => p.id));
      counts = {
        added: delta.upsert.filter((p) => !had.has(p.id)).length,
        updated: delta.upsert.filter((p) => had.has(p.id)).length,
        deprecated: delta.deprecate.length,
      };
    }
  }
}

const manifest = {
  schema: 1,
  catalogVersion: version,
  catalogSchemaVersion: 1,
  released: catalog.meta.released,
  minAppVersion: catalog.meta.minAppVersion,
  urgent: process.argv.includes('--urgent'),
  channel: 'stable',
  counts,
  full,
  ...(Object.keys(deltas).length > 0 ? { deltas } : {}),
};
manifest.signature = cryptoSign(null, Buffer.from(canonicalise(manifest), 'utf8'), privateKey).toString('base64');

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
mkdirSync('releases', { recursive: true });
writeFileSync(join('releases', `${version}.json`), JSON.stringify(catalog), 'utf8');

console.log(`catalog ${version}: ${products.length} products, full ${(full.bytes / 1024).toFixed(1)} KB`);
for (const [from, ref] of Object.entries(deltas)) {
  console.log(`  delta from ${from}: ${(ref.bytes / 1024).toFixed(1)} KB`);
}
console.log(`  +${counts.added} new, ${counts.updated} updated, ${counts.deprecated} deprecated`);
