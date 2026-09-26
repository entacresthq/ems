/**
 * Shrink a photo before upload so it goes through on a weak mobile signal.
 * Phone cameras produce 3–8 MB images; a passport photo needs far less.
 */
export async function resizeImage(file: File, maxSize = 800, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPG or PNG).')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', quality),
  )
}
