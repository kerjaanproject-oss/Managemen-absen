const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Helper to compute CRC32 for PNG chunks
function crc32(buf) {
  let c;
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  
  const typeAndData = Buffer.concat([typeBuf, data]);
  const crc = crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

function generatePNG(width, height, isMaskable = false) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // Bit depth
  ihdrData[9] = 6;  // Color type RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Generate pixels (Gradient Dark Slate / Navy to Indigo)
  const rawScanlines = [];
  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.4;

  for (let y = 0; y < height; y++) {
    const row = [0]; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      let r, g, b, a;

      // Dark background gradient
      const ny = y / height;
      r = Math.floor(15 + ny * 15);   // #0f172a to #1e293b
      g = Math.floor(23 + ny * 18);
      b = Math.floor(42 + ny * 30);
      a = 255;

      // Draw rounded container badge
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Inner Icon Circle / Fingerprint symbol area
      if (dist < radius) {
        // Vibrant Blue Gradient for Fingerprint Symbol
        const t = (dy + radius) / (2 * radius);
        r = Math.floor(13 * (1 - t) + 59 * t);   // #0d6efd to #3b82f6
        g = Math.floor(110 * (1 - t) + 130 * t);
        b = Math.floor(253 * (1 - t) + 246 * t);

        // Simple Fingerprint Arc details
        const r1 = radius * 0.3;
        const r2 = radius * 0.55;
        const r3 = radius * 0.78;

        if (Math.abs(dist - r1) < radius * 0.07 ||
            Math.abs(dist - r2) < radius * 0.07 ||
            Math.abs(dist - r3) < radius * 0.07) {
          // White fingerprint ridges
          r = 255; g = 255; b = 255;
        }
      }

      // Check maskable margin (padding if maskable)
      if (!isMaskable && dist > radius * 1.15) {
        // Optional outer background rounding for regular icons
      }

      row.push(r, g, b, a);
    }
    rawScanlines.push(Buffer.from(row));
  }

  const uncompressed = Buffer.concat(rawScanlines);
  const compressed = zlib.deflateSync(uncompressed);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const imgDir = path.join(__dirname, 'image');
if (!fs.existsSync(imgDir)) {
  fs.mkdirSync(imgDir, { recursive: true });
}

fs.writeFileSync(path.join(imgDir, 'icon-192.png'), generatePNG(192, 192, false));
fs.writeFileSync(path.join(imgDir, 'icon-512.png'), generatePNG(512, 512, false));
fs.writeFileSync(path.join(imgDir, 'icon-maskable-512.png'), generatePNG(512, 512, true));
fs.writeFileSync(path.join(imgDir, 'apple-touch-icon.png'), generatePNG(180, 180, false));

console.log('PWA Icons generated successfully in ./image/');
