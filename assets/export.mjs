import { validatePost } from './model.mjs';
const encoder = new TextEncoder();
export function toMarkdown(value) {
  const post = validatePost(value);
  const fields = ['id', 'title', 'entryDate', 'category', 'status', 'createdAt', 'updatedAt'];
  return `---\n${fields.map(key => `${key}: ${JSON.stringify(post[key])}`).join('\n')}\n---\n\n${post.content}\n`;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function markdownZip(posts) {
  if (posts.length > 65535) throw new Error('一度に出力できる記事は65535件まで');
  const chunks = [], central = [];
  let offset = 0, centralSize = 0;
  for (const value of posts) {
    const post = validatePost(value);
    const name = encoder.encode(`${post.entryDate}_${post.id}.md`);
    const data = encoder.encode(toMarkdown(post)), crc = crc32(data);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x800, true);
    lv.setUint16(12, 33, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); local.set(name,30);
    const cd = new Uint8Array(46 + name.length), cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x800, true); cv.setUint16(14, 33, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); cd.set(name,46);
    chunks.push(local, data); central.push(cd); offset += local.length + data.length; centralSize += cd.length;
    if (offset + centralSize > 0xffffffff - 22) throw new Error('出力サイズがZIPの上限を超えた');
  }
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, posts.length, true); ev.setUint16(10, posts.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + 22);
  let cursor = 0; for (const chunk of [...chunks, ...central, end]) { result.set(chunk,cursor); cursor += chunk.length; }
  return result;
}
