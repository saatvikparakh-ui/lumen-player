import React, { useMemo } from 'react';
import { CustomPlaylist } from '../../types/music';
import { selectUniqueCollageCovers } from '../../services/playlistCollageLogic';
import { withAlpha } from '../../services/colorSampler';

interface Props {
  playlist: CustomPlaylist;
  accentColor: string;
}

interface TileSpec {
  left: string;
  top: string;
  width: string;
  height: string;
  rotate: number;
  clipPath: string;
  zIndex: number;
  mask?: string;
}

// 6 distinct organic collage layouts so every playlist has a bespoke art composition
const COLLAGE_PRESETS: TileSpec[][] = [
  // Variant 0: Sweeping diagonal waves + dreamy right portrait (inspired by mockup)
  [
    {
      left: '-6%',
      top: '-10%',
      width: '54%',
      height: '86%',
      rotate: -6,
      clipPath: 'polygon(0% 0%, 100% 0%, 84% 78%, 22% 100%, 0% 88%)',
      zIndex: 3
    },
    {
      left: '44%',
      top: '-12%',
      width: '52%',
      height: '66%',
      rotate: 3,
      clipPath: 'polygon(12% 0%, 100% 0%, 100% 82%, 44% 100%, 0% 76%)',
      zIndex: 2
    },
    {
      left: '14%',
      top: '24%',
      width: '56%',
      height: '82%',
      rotate: -2,
      clipPath: 'ellipse(54% 50% at 50% 52%)',
      zIndex: 2
    },
    {
      left: '56%',
      top: '24%',
      width: '50%',
      height: '82%',
      rotate: 5,
      clipPath: 'ellipse(52% 52% at 55% 50%)',
      zIndex: 4
    },
    {
      left: '34%',
      top: '-14%',
      width: '32%',
      height: '44%',
      rotate: 10,
      clipPath: 'circle(48% at 50% 50%)',
      zIndex: 3
    }
  ],
  // Variant 1: Centered hero mosaic with curved wing covers
  [
    {
      left: '22%',
      top: '-8%',
      width: '56%',
      height: '92%',
      rotate: -3,
      clipPath: 'polygon(8% 0%, 96% 4%, 92% 96%, 4% 92%)',
      zIndex: 4
    },
    {
      left: '-8%',
      top: '4%',
      width: '44%',
      height: '90%',
      rotate: -8,
      clipPath: 'ellipse(56% 52% at 44% 50%)',
      zIndex: 2
    },
    {
      left: '64%',
      top: '-4%',
      width: '44%',
      height: '94%',
      rotate: 7,
      clipPath: 'ellipse(56% 54% at 56% 50%)',
      zIndex: 3
    },
    {
      left: '4%',
      top: '46%',
      width: '40%',
      height: '60%',
      rotate: 4,
      clipPath: 'circle(50% at 50% 50%)',
      zIndex: 3
    },
    {
      left: '58%',
      top: '46%',
      width: '40%',
      height: '60%',
      rotate: -5,
      clipPath: 'circle(50% at 50% 50%)',
      zIndex: 2
    }
  ],
  // Variant 2: Flowing overlapping ribbons
  [
    {
      left: '-4%',
      top: '-6%',
      width: '46%',
      height: '98%',
      rotate: -4,
      clipPath: 'polygon(0% 0%, 100% 0%, 76% 100%, 0% 100%)',
      zIndex: 3
    },
    {
      left: '30%',
      top: '-10%',
      width: '46%',
      height: '104%',
      rotate: 2,
      clipPath: 'polygon(18% 0%, 100% 0%, 82% 100%, 0% 100%)',
      zIndex: 4
    },
    {
      left: '62%',
      top: '-6%',
      width: '44%',
      height: '98%',
      rotate: 4,
      clipPath: 'polygon(20% 0%, 100% 0%, 100% 100%, 0% 100%)',
      zIndex: 2
    },
    {
      left: '10%',
      top: '38%',
      width: '38%',
      height: '66%',
      rotate: -7,
      clipPath: 'ellipse(52% 48% at 50% 50%)',
      zIndex: 5
    },
    {
      left: '54%',
      top: '36%',
      width: '40%',
      height: '66%',
      rotate: 6,
      clipPath: 'ellipse(52% 48% at 50% 50%)',
      zIndex: 3
    }
  ],
  // Variant 3: Asymmetric editorial gallery
  [
    {
      left: '-6%',
      top: '-8%',
      width: '60%',
      height: '78%',
      rotate: -3,
      clipPath: 'polygon(0% 0%, 100% 0%, 88% 90%, 0% 100%)',
      zIndex: 3
    },
    {
      left: '48%',
      top: '-10%',
      width: '58%',
      height: '74%',
      rotate: 5,
      clipPath: 'polygon(14% 0%, 100% 0%, 100% 100%, 4% 86%)',
      zIndex: 2
    },
    {
      left: '38%',
      top: '28%',
      width: '54%',
      height: '78%',
      rotate: -4,
      clipPath: 'ellipse(54% 50% at 50% 50%)',
      zIndex: 4
    },
    {
      left: '-4%',
      top: '36%',
      width: '50%',
      height: '72%',
      rotate: 6,
      clipPath: 'ellipse(54% 50% at 46% 52%)',
      zIndex: 3
    },
    {
      left: '26%',
      top: '-12%',
      width: '36%',
      height: '52%',
      rotate: 8,
      clipPath: 'circle(48% at 50% 50%)',
      zIndex: 4
    }
  ],
  // Variant 4: Painted petal cluster
  [
    {
      left: '16%',
      top: '-12%',
      width: '52%',
      height: '86%',
      rotate: 4,
      clipPath: 'ellipse(54% 52% at 50% 48%)',
      zIndex: 4
    },
    {
      left: '-10%',
      top: '-4%',
      width: '48%',
      height: '96%',
      rotate: -7,
      clipPath: 'ellipse(52% 56% at 48% 50%)',
      zIndex: 3
    },
    {
      left: '56%',
      top: '-6%',
      width: '52%',
      height: '92%',
      rotate: 6,
      clipPath: 'ellipse(54% 54% at 52% 48%)',
      zIndex: 3
    },
    {
      left: '30%',
      top: '34%',
      width: '48%',
      height: '72%',
      rotate: -5,
      clipPath: 'ellipse(56% 50% at 50% 54%)',
      zIndex: 5
    },
    {
      left: '70%',
      top: '36%',
      width: '36%',
      height: '66%',
      rotate: 9,
      clipPath: 'circle(50% at 50% 50%)',
      zIndex: 2
    }
  ],
  // Variant 5: Mirrored sweep with soft vignette orbs
  [
    {
      left: '48%',
      top: '-10%',
      width: '58%',
      height: '86%',
      rotate: 5,
      clipPath: 'polygon(14% 0%, 100% 0%, 100% 90%, 24% 100%, 0% 68%)',
      zIndex: 3
    },
    {
      left: '-6%',
      top: '-12%',
      width: '56%',
      height: '72%',
      rotate: -4,
      clipPath: 'polygon(0% 0%, 92% 0%, 100% 78%, 54% 100%, 0% 82%)',
      zIndex: 2
    },
    {
      left: '28%',
      top: '22%',
      width: '52%',
      height: '84%',
      rotate: 3,
      clipPath: 'ellipse(54% 50% at 50% 52%)',
      zIndex: 4
    },
    {
      left: '-6%',
      top: '28%',
      width: '48%',
      height: '80%',
      rotate: -6,
      clipPath: 'ellipse(52% 52% at 45% 50%)',
      zIndex: 3
    },
    {
      left: '34%',
      top: '-14%',
      width: '34%',
      height: '46%',
      rotate: -9,
      clipPath: 'circle(48% at 50% 50%)',
      zIndex: 4
    }
  ]
];

export const PlaylistArtCollage: React.FC<Props> = ({ playlist, accentColor }) => {
  const { covers, hasCustomHero, layoutVariant } = useMemo(
    () => selectUniqueCollageCovers(playlist),
    [playlist.id, playlist.name, playlist.coverUrl, playlist.tracks]
  );

  const preset = COLLAGE_PRESETS[layoutVariant] || COLLAGE_PRESETS[0];

  // Clean fallback for 0 unique covers
  if (covers.length === 0) {
    return (
      <div
        className="relative w-full h-full overflow-hidden"
        style={{
          background: `radial-gradient(circle at 30% 25%, ${withAlpha(accentColor, 0.65)} 0%, ${withAlpha(playlist.coverColor || '#63E8FF', 0.35)} 45%, #080A10 100%)`
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#080A10]/35 to-[#080A10]" />
      </div>
    );
  }

  // Clean seamless single-cover hero when playlist only has 1 unique album cover (never duplicates!)
  if (covers.length === 1) {
    return (
      <div className="relative w-full h-full overflow-hidden">
        <img
          src={covers[0]}
          alt={playlist.name}
          className="w-full h-full object-cover scale-105"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgba(8,10,16,0.18) 0%, rgba(8,10,16,0.22) 45%, rgba(8,10,16,0.92) 100%)`
          }}
        />
      </div>
    );
  }

  // 2 or 3 unique covers: balanced organic split with zero duplication
  const activeTiles: TileSpec[] =
    covers.length === 2
      ? [
          {
            left: '-6%',
            top: '-8%',
            width: '62%',
            height: '112%',
            rotate: -4,
            clipPath: 'polygon(0% 0%, 100% 0%, 78% 100%, 0% 100%)',
            zIndex: 3
          },
          {
            left: '44%',
            top: '-8%',
            width: '62%',
            height: '112%',
            rotate: 4,
            clipPath: 'polygon(18% 0%, 100% 0%, 100% 100%, 0% 100%)',
            zIndex: 2
          }
        ]
      : covers.length === 3
        ? [
            {
              left: hasCustomHero ? '18%' : '-6%',
              top: '-10%',
              width: hasCustomHero ? '64%' : '48%',
              height: '108%',
              rotate: hasCustomHero ? -2 : -5,
              clipPath: hasCustomHero
                ? 'ellipse(54% 54% at 50% 48%)'
                : 'polygon(0% 0%, 100% 0%, 82% 100%, 0% 100%)',
              zIndex: 4
            },
            {
              left: hasCustomHero ? '-8%' : '30%',
              top: '-6%',
              width: '48%',
              height: '106%',
              rotate: hasCustomHero ? -6 : 2,
              clipPath: 'ellipse(54% 52% at 50% 50%)',
              zIndex: 2
            },
            {
              left: '58%',
              top: '-8%',
              width: '48%',
              height: '108%',
              rotate: 5,
              clipPath: 'ellipse(54% 54% at 52% 48%)',
              zIndex: 3
            }
          ]
        : preset.slice(0, covers.length);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0A0C14]">
      {/* Dreamy blurred ambient color base sampled from first cover so seams glow organically */}
      <img
        src={covers[0]}
        alt=""
        className="pointer-events-none absolute inset-0 w-full h-full object-cover scale-125 blur-2xl saturate-150 opacity-80"
      />

      {/* Overlapping Organic Art Tiles */}
      {covers.map((url, idx) => {
        const spec = activeTiles[idx] || preset[idx % preset.length];
        return (
          <div
            key={`${url}-${idx}`}
            className="absolute overflow-hidden"
            style={{
              left: spec.left,
              top: spec.top,
              width: spec.width,
              height: spec.height,
              zIndex: spec.zIndex,
              transform: `rotate(${spec.rotate}deg)`,
              clipPath: spec.clipPath,
              WebkitClipPath: spec.clipPath,
              filter: 'drop-shadow(0 10px 22px rgba(0, 0, 0, 0.65))'
            }}
          >
            <img
              src={url}
              alt=""
              className="w-full h-full object-cover scale-105"
              style={{
                maskImage: 'radial-gradient(ellipse 92% 92% at 50% 50%, black 72%, transparent 100%)',
                WebkitMaskImage: 'radial-gradient(ellipse 92% 92% at 50% 50%, black 72%, transparent 100%)'
              }}
            />
            {/* Soft artistic specular highlight */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, transparent 45%, rgba(0,0,0,0.28) 100%)'
              }}
            />
          </div>
        );
      })}

      {/* Atmospheric color wash + smooth seamless bottom fade into playlist tracklist */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: `radial-gradient(circle at 50% 18%, ${withAlpha(accentColor, 0.16)} 0%, transparent 65%), linear-gradient(180deg, rgba(8,10,16,0.22) 0%, rgba(8,10,16,0.06) 35%, rgba(8,10,16,0.58) 76%, rgba(8,10,16,0.96) 100%)`
        }}
      />
    </div>
  );
};
