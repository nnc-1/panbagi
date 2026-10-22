/**
 * Clean an uploaded SVG asset: drop scripts, event handlers, foreignObject and any
 * non-data external reference. Returns null when the file is not an SVG at all.
 */
export function sanitizeSvg(text: string): string | null {
  if (!/<svg[\s>]/i.test(text)) return null;
  let s = text
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script[^>]*\/>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/\s([\w.-]+:)?on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  // href / xlink:href may only point inside the document (#id) or carry data: images.
  // any prefix counts (xlink:href, or the same namespace bound as xl:href)
  s = s.replace(/\s([\w.-]+:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _x, _q, a, b) => {
    const v = (a ?? b ?? '').trim();
    return v.startsWith('#') || /^data:image\/(png|jpe?g|webp|gif);/i.test(v) ? m : '';
  });
  s = s.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
  return s;
}
