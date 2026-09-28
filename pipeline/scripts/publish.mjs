// Step 9: hand the packed files to the app.
//
// Run:  node pipeline/scripts/publish.mjs <out_dir> <public_dir>
//
// - gltfpack 1.3.0 drops asset.copyright, so this puts the raw export's copyright line back into each
//   packed GLB (rewrites the JSON chunk only; the binary chunk is untouched).
// - Copies skeleton.glb, muscles.glb and joint-map.json into <public_dir> (the app serves public/anatomy/).
// - Fails if a copyright is missing or the three files together pass the size cap.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? 'pipeline/out';
const PUB = process.argv[3] ?? 'public/anatomy';
const CAP = 5 * 1024 * 1024; // committed anatomy must stay small (CC BY-SA files in a public repo)

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jsonLen = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${file}: first chunk is not JSON`);
  const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
  const rest = b.subarray(20 + jsonLen); // remaining chunks (BIN), copied as is
  return { json, rest };
}

function writeGlb(file, json, rest) {
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (text.length % 4)) % 4;
  text = Buffer.concat([text, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(file, Buffer.concat([header, text, rest]));
}

fs.mkdirSync(PUB, { recursive: true });
let total = 0;
for (const layer of ['skeleton', 'muscles']) {
  const raw = readGlb(path.join(OUT, `${layer}.raw.glb`)).json;
  const packed = readGlb(path.join(OUT, `${layer}.glb`));
  const copyright = raw.asset?.copyright;
  if (!copyright) throw new Error(`${layer}.raw.glb has no asset.copyright`);
  packed.json.asset = { ...packed.json.asset, copyright };
  const dst = path.join(PUB, `${layer}.glb`);
  writeGlb(dst, packed.json, packed.rest);
  const back = readGlb(dst).json.asset.copyright;
  if (back !== copyright) throw new Error(`${dst}: copyright did not stick`);
  const n = fs.statSync(dst).size;
  total += n;
  console.log(`PUB ${dst} ${n} bytes, copyright kept`);
}
fs.copyFileSync(path.join(OUT, 'joint-map.json'), path.join(PUB, 'joint-map.json'));
total += fs.statSync(path.join(PUB, 'joint-map.json')).size;
console.log(`PUB ${path.join(PUB, 'joint-map.json')}; total ${total} bytes`);
if (total > CAP) throw new Error(`anatomy files are ${total} bytes, over the ${CAP} byte cap`);
