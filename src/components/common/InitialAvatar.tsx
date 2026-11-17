import React from 'react';

interface Props {
  name?: string;
  username?: string;
  imageUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  isOnline?: boolean;
  accentColor?: string;
}

export const InitialAvatar: React.FC<Props> = ({
  name,
  username,
  imageUrl,
  size = 'md',
  className = '',
  isOnline = false,
  accentColor
}) => {
  const [imgError, setImgError] = React.useState(false);
  const cleanName = (name || username || 'U').replace(/^@/, '').trim();
  const initial = cleanName.length > 0 ? cleanName.charAt(0).toUpperCase() : 'U';

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-lg',
    xl: 'w-20 h-20 text-2xl'
  }[size];

  const dotSizeClasses = {
    xs: 'w-2 h-2',
    sm: 'w-2.5 h-2.5',
    md: 'w-3 h-3',
    lg: 'w-3.5 h-3.5',
    xl: 'w-4 h-4'
  }[size];

  return (
    <div className={`relative inline-flex items-center justify-center flex-shrink-0 select-none ${className}`}>
      {/* Outer Glowing Glass Ring */}
      <div 
        className={`${sizeClasses} rounded-full p-0.5 transition-all duration-300 flex items-center justify-center`}
        style={{
          background: isOnline 
            ? 'linear-gradient(135deg, #10b981, #06b6d4)' 
            : accentColor 
            ? `linear-gradient(135deg, ${accentColor}90, rgba(255,255,255,0.2))`
            : 'linear-gradient(135deg, rgba(255,255,255,0.25), rgba(255,255,255,0.05))',
          boxShadow: isOnline 
            ? '0 0 14px rgba(52, 211, 153, 0.4)' 
            : accentColor 
            ? `0 0 12px ${accentColor}40`
            : '0 4px 12px rgba(0,0,0,0.5)'
        }}
      >
        {/* Obsidian Glass Core */}
        <div className="w-full h-full rounded-full bg-[#0a0d14] flex items-center justify-center border border-black/40 shadow-inner overflow-hidden">
          {imageUrl && !imgError ? (
            <img 
              src={imageUrl} 
              alt={cleanName} 
              className="w-full h-full object-cover rounded-full" 
              onError={() => setImgError(true)} 
            />
          ) : (
            <span className="font-syne font-bold text-white tracking-tight">
              {initial}
            </span>
          )}
        </div>
      </div>

      {/* Online Status Indicator */}
      {isOnline && (
        <span 
          className={`absolute bottom-0 right-0 ${dotSizeClasses} rounded-full bg-emerald-400 border-2 border-[#07090E] shadow-[0_0_6px_#34d399]`}
        />
      )}
    </div>
  );
};
