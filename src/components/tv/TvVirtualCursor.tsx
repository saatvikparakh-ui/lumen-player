import React from 'react';
import { ClickRipple, CursorPosition } from '../../hooks/useTvVirtualCursor';
import { MousePointer2 } from 'lucide-react';

interface TvVirtualCursorProps {
  pos: CursorPosition;
  isHoveringClickable: boolean;
  ripples: ClickRipple[];
  dominantColor?: string;
  isCursorActive?: boolean;
}

export const TvVirtualCursor: React.FC<TvVirtualCursorProps> = ({
  pos,
  isHoveringClickable,
  ripples,
  dominantColor = '#63E8FF',
  isCursorActive = true
}) => {
  if (!isCursorActive) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999] select-none overflow-hidden">
      {/* 1. Click Ripple Waves */}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="absolute rounded-full pointer-events-none animate-ping"
          style={{
            left: ripple.x - 24,
            top: ripple.y - 24,
            width: 48,
            height: 48,
            backgroundColor: `${dominantColor}40`,
            border: `2px solid ${dominantColor}`,
            boxShadow: `0 0 20px ${dominantColor}`
          }}
        />
      ))}

      {/* 2. Main Glowing Cursor Pointer */}
      <div
        className="absolute transition-transform duration-75 will-change-transform flex items-center justify-center pointer-events-none"
        style={{
          transform: `translate3d(${pos.x - 14}px, ${pos.y - 14}px, 0px)`
        }}
      >
        {/* Outer Radiant Glow Ring */}
        <div
          className={`rounded-full transition-all duration-150 flex items-center justify-center ${
            isHoveringClickable
              ? 'w-10 h-10 border-2 scale-110 shadow-lg'
              : 'w-7 h-7 border scale-100'
          }`}
          style={{
            borderColor: dominantColor,
            backgroundColor: `${dominantColor}15`,
            boxShadow: isHoveringClickable
              ? `0 0 25px ${dominantColor}, inset 0 0 10px ${dominantColor}50`
              : `0 0 12px ${dominantColor}60`
          }}
        >
          {/* Inner Solid White/Cyan Pip */}
          <div
            className={`rounded-full transition-all duration-100 ${
              isHoveringClickable ? 'w-3 h-3 bg-white' : 'w-2 h-2'
            }`}
            style={{
              backgroundColor: isHoveringClickable ? '#FFFFFF' : dominantColor,
              boxShadow: `0 0 8px ${dominantColor}`
            }}
          />
        </div>

        {/* Small Precision Pointer Chevron Tip */}
        <div
          className="absolute -top-1.5 -left-1.5 pointer-events-none drop-shadow-md"
          style={{ color: dominantColor }}
        >
          <MousePointer2 className="w-4 h-4 fill-white text-black" />
        </div>
      </div>
    </div>
  );
};
