import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mkdir, writeFile } from 'node:fs/promises';
const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, cacheDir: join(tmpdir(), 'shamal-assets-bake'), server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
try {
  const sculpt = await server.ssrLoadModule('/scripts/animalSculpt.ts');
  await mkdir('public/models', { recursive: true });
  for (const name of ['camel', 'gazelle']) {
    const parts = name === 'camel' ? sculpt.buildCamel() : sculpt.buildGazelle();
    const metadata = {}, buffers = [];
    let offset = 0;
    for (const [part, original] of Object.entries(parts)) {
      const geometry = mergeVertices(original, 0.0001);
      metadata[part] = {};
      for (const [attribute, value] of Object.entries({ ...geometry.attributes, index: geometry.index })) {
        // UVs aren't needed by the fur shader.
        if (['uv','aLeg','aHip'].includes(attribute)) continue;
        let array = value.array, normalized = false;
        if (attribute === 'normal') { array = Int16Array.from(array, n => Math.round(Math.max(-1, Math.min(1, n)) * 32767)); normalized = true; }
        if (attribute === 'color') { array = Uint8Array.from(array, n => Math.round(Math.max(0, Math.min(1, n)) * 255)); normalized = true; }
        if (attribute === 'aLeg') array = Uint8Array.from(array);
        const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
        metadata[part][attribute] = { offset, length: array.length, size: value.itemSize, type: array.constructor.name, normalized };
        buffers.push(data); offset += data.length;
        const padding = (4 - offset % 4) % 4;
        buffers.push(Buffer.alloc(padding)); offset += padding;
      }
      geometry.dispose(); original.dispose();
    }
    let header = JSON.stringify(metadata);
    header += ' '.repeat((4 - Buffer.byteLength(header) % 4) % 4);
    const size = Buffer.alloc(4); size.writeUInt32LE(Buffer.byteLength(header));
    const file = Buffer.concat([size, Buffer.from(header), ...buffers]);
    await writeFile('public/models/' + name + '.mesh', file);
    console.log(name + ': ' + file.length.toLocaleString() + ' bytes');
  }
} finally { await server.close(); }
