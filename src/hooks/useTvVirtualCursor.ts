import { useState, useEffect, useRef, useCallback } from 'react';

export interface CursorPosition {
  x: number;
  y: number;
}

export interface ClickRipple {
  id: number;
  x: number;
  y: number;
}

interface UseTvVirtualCursorOptions {
  enabled?: boolean;
  dominantColor?: string;
}

export function useTvVirtualCursor({ enabled = true, dominantColor = '#63E8FF' }: UseTvVirtualCursorOptions = {}) {
  const [pos, setPos] = useState<CursorPosition>(() => ({
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 960,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 540
  }));

  const [isHoveringClickable, setIsHoveringClickable] = useState(false);
  const [ripples, setRipples] = useState<ClickRipple[]>([]);
  const [isCursorActive, setIsCursorActive] = useState(true);

  const posRef = useRef<CursorPosition>({
    x: typeof window !== 'undefined' ? window.innerWidth / 2 : 960,
    y: typeof window !== 'undefined' ? window.innerHeight / 2 : 540
  });

  const keysHeld = useRef<Record<string, boolean>>({});
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const velocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const hoveredElementRef = useRef<HTMLElement | null>(null);

  // Smooth acceleration update loop
  const updateCursor = useCallback((timestamp: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.1);
    lastTimeRef.current = timestamp;

    let dirX = 0;
    let dirY = 0;

    if (keysHeld.current['ArrowLeft']) dirX -= 1;
    if (keysHeld.current['ArrowRight']) dirX += 1;
    if (keysHeld.current['ArrowUp']) dirY -= 1;
    if (keysHeld.current['ArrowDown']) dirY += 1;

    const isMoving = dirX !== 0 || dirY !== 0;

    const BASE_SPEED = 450; // px/sec
    const MAX_SPEED = 1200; // px/sec
    const ACCEL = 2200; // px/sec^2
    const FRICTION = 0.82;

    if (isMoving) {
      // Normalize direction vector
      const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
      const targetVx = (dirX / len) * MAX_SPEED;
      const targetVy = (dirY / len) * MAX_SPEED;

      velocityRef.current.vx += (targetVx - velocityRef.current.vx) * Math.min(1, ACCEL * dt / MAX_SPEED);
      velocityRef.current.vy += (targetVy - velocityRef.current.vy) * Math.min(1, ACCEL * dt / MAX_SPEED);
    } else {
      velocityRef.current.vx *= FRICTION;
      velocityRef.current.vy *= FRICTION;
      if (Math.abs(velocityRef.current.vx) < 5) velocityRef.current.vx = 0;
      if (Math.abs(velocityRef.current.vy) < 5) velocityRef.current.vy = 0;
    }

    if (Math.abs(velocityRef.current.vx) > 0.5 || Math.abs(velocityRef.current.vy) > 0.5) {
      const newX = Math.max(12, Math.min(window.innerWidth - 12, posRef.current.x + velocityRef.current.vx * dt));
      const newY = Math.max(12, Math.min(window.innerHeight - 12, posRef.current.y + velocityRef.current.vy * dt));

      posRef.current = { x: newX, y: newY };
      setPos({ x: newX, y: newY });

      // Detect element beneath cursor
      const el = document.elementFromPoint(newX, newY) as HTMLElement | null;
      if (el) {
        const interactive = el.closest('button, a, input, select, textarea, [role="button"], [tabindex], .cursor-pointer') as HTMLElement | null;
        if (interactive !== hoveredElementRef.current) {
          if (hoveredElementRef.current) {
            hoveredElementRef.current.classList.remove('tv-cursor-hover');
          }
          if (interactive) {
            interactive.classList.add('tv-cursor-hover');
            setIsHoveringClickable(true);
          } else {
            setIsHoveringClickable(false);
          }
          hoveredElementRef.current = interactive;
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(updateCursor);
  }, []);

  useEffect(() => {
    if (!enabled || !isCursorActive) {
      if (hoveredElementRef.current) {
        hoveredElementRef.current.classList.remove('tv-cursor-hover');
        hoveredElementRef.current = null;
      }
      return;
    }

    animFrameRef.current = requestAnimationFrame(updateCursor);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in text inputs
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        keysHeld.current[e.key] = true;
      } else if (e.key === 'Enter' || e.key === 'Select') {
        // Trigger click at current cursor position
        const target = hoveredElementRef.current || (document.elementFromPoint(posRef.current.x, posRef.current.y) as HTMLElement | null);
        if (target) {
          e.preventDefault();
          const clickTarget = (target.closest('button, a, input, [role="button"], [tabindex], .cursor-pointer') as HTMLElement | null) || target;

          // Add visual ripple
          const rippleId = Date.now();
          setRipples(prev => [...prev, { id: rippleId, x: posRef.current.x, y: posRef.current.y }]);
          setTimeout(() => {
            setRipples(prev => prev.filter(r => r.id !== rippleId));
          }, 650);

          // Focus & trigger click
          try {
            clickTarget.focus();
            clickTarget.click();
          } catch (_) {}
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        keysHeld.current[e.key] = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp, { passive: true });

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (hoveredElementRef.current) {
        hoveredElementRef.current.classList.remove('tv-cursor-hover');
        hoveredElementRef.current = null;
      }
    };
  }, [enabled, isCursorActive, updateCursor]);

  const toggleCursor = useCallback(() => {
    setIsCursorActive(prev => !prev);
  }, []);

  return {
    pos,
    isHoveringClickable,
    ripples,
    isCursorActive,
    toggleCursor
  };
}
