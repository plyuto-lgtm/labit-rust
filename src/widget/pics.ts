// A picture made ready to send (the board's paste and a comment's attachment both): the file as it is when it is a small
// png, webp or gif (a gif keeps its animation); anything else (a photo, HEIC and AVIF, a big screenshot) is drawn again at
// `side` px on its long side and encoded as webp or jpeg, which also bakes in its orientation and leaves its EXIF (and GPS)
// behind. Its own file (public/_lab/pics.js), loaded the first time a picture is put in.
export async function prep(file: Blob, max: number, side: number): Promise<Blob | null> {
  let src: CanvasImageSource & { width: number; height: number };
  try {
    src = await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    src = await new Promise<HTMLImageElement>((ok, no) => {
      const img = Object.assign(new Image(), { onload: () => ok(img), onerror: no, src: url });
    }).catch(() => null as never);
    URL.revokeObjectURL(url);
  }
  if (!src?.width) return null;
  const long = Math.max(src.width, src.height);
  if (/^image\/(png|webp|gif)$/.test(file.type) && long <= side && file.size <= max) return file;
  const k = Math.min(1, side / long);
  const cv = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(src.width * k)), height: Math.max(1, Math.round(src.height * k)) });
  cv.getContext('2d')!.drawImage(src, 0, 0, cv.width, cv.height);
  const enc = (t: string, q: number) => new Promise<Blob | null>((ok) => cv.toBlob(ok, t, q));
  let out = /^image\/(png|webp|gif)$/.test(file.type) ? await enc('image/webp', 0.9) : null; // (Safari answers a png)
  for (const q of [0.88, 0.6]) if (!out || out.size > max) out = await enc('image/jpeg', q);
  return out;
}

/** A picture sent to the lab (POST /_lab/api/image + query: a frame of a board, or a comment's attachment): made ready, then
 *  sent with this computer's key when the page has one (data-admin) and its pass cookie otherwise. The lab's answer, or an
 *  Error that says why not. */
export async function send<T>(query: string, file: Blob, max: number, side: number): Promise<T> {
  const blob = await prep(file, max, side);
  if (!blob || !/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error("That file isn't an image the lab can show.");
  const admin = document.querySelector<HTMLScriptElement>('script[data-admin]')?.dataset.admin;
  const res = await fetch(`/_lab/api/image${query}`, { method: 'POST', headers: { 'content-type': blob.type, ...(admin && { 'x-lab-admin': admin }) }, body: blob });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error || `The lab could not take it (${res.status}).`);
  return res.json();
}
