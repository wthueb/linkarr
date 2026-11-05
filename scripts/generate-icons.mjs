import { mkdirSync, writeFileSync } from "node:fs";
import { zlibSync } from "fflate";

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const body = Buffer.concat([Buffer.from(name), data]);
  const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), body.length + 4);
  return result;
}
mkdirSync("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const data = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const arrow =
        (Math.abs(u + v - 1) < 0.075 && u > 0.25 && u < 0.76) ||
        (u > 0.4 && u < 0.78 && v > 0.22 && v < 0.32) ||
        (u > 0.68 && u < 0.78 && v > 0.22 && v < 0.6);
      const offset = y * (1 + size * 4) + 1 + x * 4;
      const color = arrow ? [20, 39, 28, 255] : [164, 239, 198, 255];
      color.forEach((channel, i) => {
        data[offset + i] = channel;
      });
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  writeFileSync(
    `public/icons/${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", zlibSync(data)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
