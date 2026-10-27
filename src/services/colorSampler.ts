/**
 * Samples dominant and accent colors from an album art URL via an off-screen canvas.
 * Returns vibrant cyan/violet fallbacks if art is unavailable or cannot be loaded.
 */

export interface ColorSample {
  dominant: string;       // hex or rgb
  palette?: [string, string, string, string]; // 4 distinct harmonic shades for perimeter gradient flow
  glowRgba: string;       // rgba with alpha for box-shadows/glows
  secondaryGlow: string;  // complementary violet/cyan
}

const colorCache = new Map<string, ColorSample>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `rgb(${Math.round(255 * f(0))}, ${Math.round(255 * f(8))}, ${Math.round(255 * f(4))})`;
}

export const DEFAULT_PALETTE: [string, string, string, string] = [
  '#63E8FF',
  '#9A76FF',
  '#FF2E93',
  '#38BDF8'
];

export async function extractDominantColor(imageUrl?: string | null): Promise<ColorSample> {
  const fallback: ColorSample = {
    dominant: '#63E8FF',
    palette: DEFAULT_PALETTE,
    glowRgba: 'rgba(99, 232, 255, 0.35)',
    secondaryGlow: 'rgba(154, 118, 255, 0.25)',
  };

  if (!imageUrl) return fallback;
  if (colorCache.has(imageUrl)) return colorCache.get(imageUrl)!;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;

    const timeout = setTimeout(() => {
      resolve(fallback);
    }, 1500);

    img.onload = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallback);
          return;
        }

        // Downscale image to 32x32 for fast sampling
        canvas.width = 32;
        canvas.height = 32;
        ctx.drawImage(img, 0, 0, 32, 32);

        const imageData = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < imageData.length; i += 16) {
          const red = imageData[i];
          const green = imageData[i + 1];
          const blue = imageData[i + 2];
          // Skip pure blacks, pure whites, and near-greys to find vibrant colors
          const brightness = (red + green + blue) / 3;
          const maxDiff = Math.max(Math.abs(red - green), Math.abs(green - blue), Math.abs(blue - red));
          if (brightness > 25 && brightness < 235 && maxDiff > 15) {
            r += red;
            g += green;
            b += blue;
            count++;
          }
        }

        if (count === 0) {
          resolve(fallback);
          return;
        }

        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        // Convert to HSL and boost saturation so even earthy/dark artwork radiates vivid neon glow
        const [h, s, l] = rgbToHsl(r, g, b);
        const neonS = Math.max(80, Math.min(100, s + 35));
        const neonL = Math.max(50, Math.min(65, l > 40 ? l : 55));

        const dominant = hslToRgb(h, neonS, neonL);
        const palette: [string, string, string, string] = [
          dominant,
          hslToRgb((h + 8) % 360, Math.min(100, neonS + 10), Math.min(72, neonL + 8)),
          hslToRgb((h + 352) % 360, Math.min(100, neonS + 5), Math.max(40, neonL - 8)),
          hslToRgb(h, Math.min(100, neonS + 15), Math.min(68, neonL + 4))
        ];

        const glowRgba = `rgba(${r}, ${g}, ${b}, 0.55)`;
        const secondaryGlow = `rgba(${Math.min(255, r + 40)}, ${Math.max(0, g - 20)}, ${Math.min(255, b + 50)}, 0.35)`;

        const sample: ColorSample = { dominant, palette, glowRgba, secondaryGlow };
        colorCache.set(imageUrl, sample);
        resolve(sample);
      } catch (err) {
        resolve(fallback);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      resolve(fallback);
    };
  });
}
