import React from 'react';

interface Props {
  artist: string;
  onSelectArtist: (artist: string) => void;
  className?: string;
  linkClassName?: string;
  separatorClassName?: string;
}

export function parseArtistNames(artistStr: string): Array<{ name: string; separatorAfter?: string }> {
  if (!artistStr) return [];

  // Match separators while capturing them: comma, &, feat., ft., with, semicolon, slash
  const separatorRegex = /(\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|with)\s+|\s*;\s*|\s*\/\s*)/gi;
  const parts = artistStr.split(separatorRegex);

  const result: Array<{ name: string; separatorAfter?: string }> = [];
  for (let i = 0; i < parts.length; i += 2) {
    const name = (parts[i] || '').trim();
    const separatorAfter = parts[i + 1] || undefined;
    if (name) {
      result.push({ name, separatorAfter });
    }
  }

  return result.length > 0 ? result : [{ name: artistStr.trim() }];
}

export const ArtistLinks: React.FC<Props> = ({
  artist,
  onSelectArtist,
  className = '',
  linkClassName = 'hover:underline hover:text-white transition-colors cursor-pointer',
  separatorClassName = 'text-white/40 select-none'
}) => {
  const parsed = parseArtistNames(artist);

  return (
    <span 
      className={`inline-flex items-center ${className.includes('truncate') || className.includes('nowrap') ? 'flex-nowrap truncate max-w-full' : 'flex-wrap'} ${className}`} 
      onClick={(e) => e.stopPropagation()}
    >
      {parsed.map((item, idx) => (
        <React.Fragment key={idx}>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelectArtist(item.name);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onSelectArtist(item.name);
              }
            }}
            className={linkClassName}
            title={`View ${item.name}`}
          >
            {item.name}
          </span>
          {item.separatorAfter && (
            <span className={separatorClassName}>
              {item.separatorAfter}
            </span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
};
