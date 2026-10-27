const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_BYTES = 64 * 1024;

/** Decode a local raster, crop the centre and discard source metadata via canvas. */
export async function prepareAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('请选择小于 5 MB 的图片');
  if (!file.size) throw new Error('图片文件为空');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('无法读取图片，请换一张重试'));
      node.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 12000 || image.naturalHeight > 12000)
      throw new Error('图片尺寸过大或无效');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理头像');
    context.fillStyle = '#edf4fd';
    context.fillRect(0, 0, 256, 256);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    for (const quality of [0.84, 0.65, 0.45]) {
      const encoded = canvas.toDataURL('image/webp', quality);
      const bytes = Math.ceil(((encoded.split(',')[1]?.length ?? 0) * 3) / 4);
      if (bytes > 0 && bytes <= MAX_AVATAR_BYTES) return encoded;
    }
    throw new Error('图片压缩后仍过大，请换一张简单的图片');
  } finally {
    URL.revokeObjectURL(url);
  }
}
