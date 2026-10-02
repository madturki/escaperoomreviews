import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);
const MAX_WIDTH = 1600;

/**
 * Copies only referenced image files from the WordPress uploads folder into public/images,
 * resizing large photos. Anything that is not an image extension is refused.
 */
export async function copyImages(uploads, uploadsDir, outDir) {
  const copied = [];
  const missing = [];
  const rejected = [];
  for (const rel of [...uploads].sort()) {
    const ext = path.extname(rel).toLowerCase();
    if (!IMAGE_EXT.has(ext) || rel.includes('..')) {
      rejected.push(rel);
      continue;
    }
    const src = path.join(uploadsDir, rel);
    if (!fs.existsSync(src)) {
      missing.push(rel);
      continue;
    }
    const dest = path.join(outDir, rel);
    if (fs.existsSync(dest) && fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs) {
      copied.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (ext === '.gif' || ext === '.avif') {
      fs.copyFileSync(src, dest);
    } else {
      try {
        let img = sharp(src, { failOn: 'none' }).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
        if (ext === '.png') img = img.png({ compressionLevel: 9 });
        else if (ext === '.webp') img = img.webp({ quality: 80 });
        else img = img.jpeg({ quality: 82, mozjpeg: true });
        await img.toFile(dest);
      } catch {
        fs.copyFileSync(src, dest);
      }
    }
    copied.push(rel);
  }
  return { copied, missing, rejected };
}
