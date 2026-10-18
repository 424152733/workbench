import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoredZipBlob } from './features/content/zip-assets.js';

async function readLocalEntries(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const entries = [];
  let offset = 0;

  while (view.getUint32(offset, true) === 0x04034b50) {
    const flags = view.getUint16(offset + 6, true);
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.push({
      flags,
      crc,
      name: decoder.decode(bytes.slice(nameStart, nameStart + nameLength)),
      data: bytes.slice(dataStart, dataStart + compressedSize),
    });
    offset = dataStart + compressedSize;
  }

  assert.equal(view.getUint32(offset, true), 0x02014b50, 'central directory follows local entries');
  return entries;
}

test('ZIP keeps UTF-8 filenames, disambiguates duplicates, and stores image bytes intact', async () => {
  const firstImage = new Blob([new Uint8Array([0, 1, 2, 255])], { type: 'image/png' });
  const secondImage = new Blob([new Uint8Array([8, 9])], { type: 'image/png' });
  const archive = await createStoredZipBlob([
    { fileName: 'covers/配图.png', blob: firstImage },
    { fileName: '配图.png', blob: secondImage },
  ]);

  assert.equal(archive.type, 'application/zip');
  const entries = await readLocalEntries(archive);
  assert.deepEqual(entries.map(({ name }) => name), ['配图.png', '配图 (2).png']);
  assert.ok(entries.every(({ flags }) => (flags & 0x0800) !== 0), 'filenames use the UTF-8 flag');
  assert.deepEqual([...entries[0].data], [0, 1, 2, 255]);
  assert.deepEqual([...entries[1].data], [8, 9]);
  assert.equal(entries[0].crc, 0x3fb23824);
});

test('ZIP rejects an empty image list with a readable message', async () => {
  await assert.rejects(createStoredZipBlob([]), /当前没有可下载的图片/);
});
