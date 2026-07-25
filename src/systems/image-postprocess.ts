import { createCanvas, loadImage } from '@napi-rs/canvas';

// Post-processing that turns an AI-generated image into a REAL Minecraft
// resource-pack texture: hard-edged pixels, flat colors, exact square size.
// Uses @napi-rs/canvas (already a dependency) so there's no native install on
// the host. Three things separate a real texture from a naive resize:
//   1. Area-average downscale (each output pixel = mean of the source block it
//      covers) -> flat single-color cells with hard edges, NOT a blurry
//      bilinear shrink.
//   2. Palette snap -> collapses near-identical colors into flat blocks like
//      hand-drawn pixel art (Minecraft textures use few, flat colors).
//   3. Nearest-neighbor UPSCALED preview -> a 16x16 PNG looks blurry in Discord
//      because the client smooths it; the preview shows the true crisp pixels.

export interface AssetOptions {
    size?: number;        // exact output side in px (16/32/64/128/256); undefined = keep source size
    transparent?: boolean; // flood-fill the flat background to alpha=0
}

export interface ProcessedAsset {
    asset: Buffer;   // the real texture at exact size — drop straight into the resource pack
    preview: Buffer; // nearest-neighbor upscale (~512px) so Discord shows crisp pixels
    size: number;    // actual asset side in px
}

// Squared Euclidean RGB distance (no sqrt — caller squares its tolerance).
function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return dr * dr + dg * dg + db * db;
}

// Remove the background by flood-filling inward from every edge pixel. Only
// pixels (a) within color tolerance of the sampled background AND (b) connected
// to an edge get cleared, so a sprite interior that matches the background color
// is preserved. Reference color = average of the 4 corners (AI art centers the
// subject on a flat backdrop, so corners are reliably background).
function removeBackground(data: Uint8ClampedArray, w: number, h: number, tolerance: number): void {
    const idx = (x: number, y: number) => (y * w + x) * 4;
    const corners = [idx(0, 0), idx(w - 1, 0), idx(0, h - 1), idx(w - 1, h - 1)];
    let br = 0, bg = 0, bb = 0;
    for (const c of corners) { br += data[c]; bg += data[c + 1]; bb += data[c + 2]; }
    br /= 4; bg /= 4; bb /= 4;

    const tolSq = tolerance * tolerance;
    const visited = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let x = 0; x < w; x++) { stack.push(x, 0, x, h - 1); }
    for (let y = 0; y < h; y++) { stack.push(0, y, w - 1, y); }

    while (stack.length) {
        const y = stack.pop()!;
        const x = stack.pop()!;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = y * w + x;
        if (visited[p]) continue;
        visited[p] = 1;
        const o = p * 4;
        if (colorDistSq(data[o], data[o + 1], data[o + 2], br, bg, bb) > tolSq) continue;
        data[o + 3] = 0;
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
}

// Area-average downscale from a source RGBA buffer to an exact size×size grid.
// Each destination pixel averages the whole source block it maps to, using
// premultiplied alpha so cleared (transparent) pixels don't bleed their stale
// RGB into edge cells. This is what gives flat, hard-edged pixel cells.
function areaAverageDownscale(src: Uint8ClampedArray, sw: number, sh: number, size: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(size * size * 4);
    for (let ty = 0; ty < size; ty++) {
        const sy0 = Math.floor((ty * sh) / size);
        const sy1 = Math.max(sy0 + 1, Math.floor(((ty + 1) * sh) / size));
        for (let tx = 0; tx < size; tx++) {
            const sx0 = Math.floor((tx * sw) / size);
            const sx1 = Math.max(sx0 + 1, Math.floor(((tx + 1) * sw) / size));
            let rA = 0, gA = 0, bA = 0, aSum = 0, n = 0;
            for (let sy = sy0; sy < sy1; sy++) {
                for (let sx = sx0; sx < sx1; sx++) {
                    const o = (sy * sw + sx) * 4;
                    const a = src[o + 3];
                    rA += src[o] * a; gA += src[o + 1] * a; bA += src[o + 2] * a;
                    aSum += a; n++;
                }
            }
            const d = (ty * size + tx) * 4;
            if (aSum > 0) {
                out[d] = rA / aSum; out[d + 1] = gA / aSum; out[d + 2] = bA / aSum;
            }
            out[d + 3] = n > 0 ? aSum / n : 0;
        }
    }
    return out;
}

// Snap the alpha channel to fully opaque / fully transparent at a midpoint, then
// quantize RGB onto a coarse grid. Real pixel-art / MC textures avoid soft edges
// and use few flat colors; this flattens the near-identical shades that survive
// downscaling into solid blocks. `levels` = shades per channel (lower = flatter).
function quantize(data: Uint8ClampedArray, levels: number): void {
    const step = 255 / (levels - 1);
    for (let i = 0; i < data.length; i += 4) {
        data[i + 3] = data[i + 3] >= 128 ? 255 : 0;
        if (data[i + 3] === 0) continue; // don't bother coloring transparent pixels
        data[i] = Math.round(Math.round(data[i] / step) * step);
        data[i + 1] = Math.round(Math.round(data[i + 1] / step) * step);
        data[i + 2] = Math.round(Math.round(data[i + 2] / step) * step);
    }
}

// Write an RGBA buffer to a canvas of its own size and return PNG bytes.
function rgbaToPng(data: Uint8ClampedArray, w: number, h: number): Buffer {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    const imgData = ctx.createImageData(w, h);
    imgData.data.set(data);
    ctx.putImageData(imgData, 0, 0);
    return c.toBuffer('image/png');
}

// Nearest-neighbor upscale a small texture to ~targetPx for a crisp Discord
// preview (integer scale so pixels stay square). Smoothing OFF is what keeps the
// blocks hard instead of blurred.
function nearestNeighborPreview(assetPng: Buffer, size: number, targetPx: number): Promise<Buffer> {
    const scale = Math.max(1, Math.floor(targetPx / size));
    const dim = size * scale;
    return loadImage(assetPng).then((img) => {
        const c = createCanvas(dim, dim);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, size, size, 0, 0, dim, dim);
        return c.toBuffer('image/png');
    });
}

// Turn AI-generated bytes into a resource-pack texture + a crisp preview.
// Pipeline: load -> (optional) background removal at native res -> area-average
// downscale to exact size -> palette snap -> PNG asset + NN-upscaled preview.
// When no size is given, emits the (optionally background-stripped) image as-is.
export async function processResourcePackAsset(input: Buffer, opts: AssetOptions): Promise<ProcessedAsset | null> {
    try {
        const img = await loadImage(input);
        const sw = img.width, sh = img.height;

        // Rasterize once; strip the background at native resolution (more color
        // info = a cleaner cut) when requested.
        const base = createCanvas(sw, sh);
        const bctx = base.getContext('2d');
        bctx.drawImage(img, 0, 0);
        const baseData = bctx.getImageData(0, 0, sw, sh);
        if (opts.transparent) removeBackground(baseData.data, sw, sh, 48);

        const size = opts.size;
        if (!size) {
            const asset = rgbaToPng(baseData.data, sw, sh);
            return { asset, preview: asset, size: Math.max(sw, sh) };
        }

        // Area-average downscale, then flatten the palette for crisp flat cells.
        const small = areaAverageDownscale(baseData.data, sw, sh, size);
        quantize(small, 6);
        const asset = rgbaToPng(small, size, size);
        const preview = await nearestNeighborPreview(asset, size, 512);
        return { asset, preview, size };
    } catch {
        return null;
    }
}
