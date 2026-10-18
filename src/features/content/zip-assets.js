const utf8 = new TextEncoder();
const crcTable = new Uint32Array(256);

for (let value = 0; value < 256; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  crcTable[value] = crc >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function archiveEntryName(fileName, index, usedNames) {
  const rawName = String(fileName || `image-${index + 1}`)
    .replaceAll('\\', '/')
    .split('/')
    .pop()
    .replace(/[\u0000-\u001f]/g, '_')
    .trim();
  const baseName = rawName && rawName !== '.' && rawName !== '..' ? rawName : `image-${index + 1}`;
  const extensionIndex = baseName.lastIndexOf('.');
  const stem = extensionIndex > 0 ? baseName.slice(0, extensionIndex) : baseName;
  const extension = extensionIndex > 0 ? baseName.slice(extensionIndex) : '';
  let candidate = baseName;
  let suffix = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${stem} (${suffix})${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export async function createStoredZipBlob(files) {
  if (!Array.isArray(files) || !files.length) throw new Error('当前没有可下载的图片');
  if (files.length > 0xffff) throw new Error('图片数量过多，无法打包下载');

  const usedNames = new Set();
  const timestamp = dosDateTime(new Date());
  const entries = await Promise.all(files.map(async (file, index) => {
    const name = utf8.encode(archiveEntryName(file.fileName, index, usedNames));
    const data = new Uint8Array(await file.blob.arrayBuffer());
    if (data.byteLength > 0xffffffff) throw new Error('单张图片超过 ZIP 格式支持的大小');
    return { name, data, crc: crc32(data) };
  }));

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const localHeader = new Uint8Array(30 + entry.name.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, timestamp.time, true);
    localView.setUint16(12, timestamp.date, true);
    localView.setUint32(14, entry.crc, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, entry.name.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(entry.name, 30);
    localParts.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(46 + entry.name.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, timestamp.time, true);
    centralView.setUint16(14, timestamp.date, true);
    centralView.setUint32(16, entry.crc, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, entry.name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(entry.name, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + entry.data.length;
    centralSize += centralHeader.length;
  }

  if (localOffset > 0xffffffff || centralSize > 0xffffffff) throw new Error('图片总大小超过 ZIP 格式支持的上限');
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' });
}
