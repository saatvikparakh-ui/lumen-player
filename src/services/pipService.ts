import { Track } from '../types/music';

/**
 * Service for Desktop OS-Level Floating Liquid-Glass Mini-Player using
 * the modern Document Picture-in-Picture (PiP) API.
 * Keeps a floating music player always-on-top above any other desktop app or browser.
 */
export class PipService {
  private static pipWindow: any = null;
  private static containerEl: HTMLElement | null = null;
  private static isOpenState: boolean = false;

  public static isSupported(): boolean {
    return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
  }

  public static isOpen(): boolean {
    return this.isOpenState && !!this.pipWindow && !this.pipWindow.closed;
  }

  public static close(): void {
    if (this.pipWindow && !this.pipWindow.closed) {
      this.pipWindow.close();
    }
    this.pipWindow = null;
    this.containerEl = null;
    this.isOpenState = false;
  }

  public static async toggle(
    track: Track | null,
    isPlaying: boolean,
    onTogglePlay: () => void,
    onNext: () => void,
    onPrev: () => void,
    dominantColor: string = '#00F0FF'
  ): Promise<boolean> {
    if (this.isOpen()) {
      this.close();
      return false;
    }
    return this.open(track, isPlaying, onTogglePlay, onNext, onPrev, dominantColor);
  }

  public static async open(
    track: Track | null,
    isPlaying: boolean,
    onTogglePlay: () => void,
    onNext: () => void,
    onPrev: () => void,
    dominantColor: string = '#00F0FF'
  ): Promise<boolean> {
    if (!this.isSupported()) {
      console.warn('[PipService] Document Picture-in-Picture not supported in this browser.');
      return false;
    }

    try {
      // 1. Request floating OS-level window
      const pip = await (window as any).documentPictureInPicture.requestWindow({
        width: 320,
        height: 380,
        disallowReturnToOpener: false
      });

      this.pipWindow = pip;
      this.isOpenState = true;

      // 2. Clone active application style sheets to the floating window
      const doc = pip.document;
      doc.title = 'Lumen Mini Player';

      // Base resets & fonts
      const baseStyle = doc.createElement('style');
      baseStyle.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
        body {
          background: #06070B;
          color: #FFFFFF;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          width: 100vw;
        }
      `;
      doc.head.appendChild(baseStyle);

      Array.from(document.styleSheets).forEach((sheet: any) => {
        try {
          if (sheet.cssRules) {
            const style = doc.createElement('style');
            style.textContent = Array.from(sheet.cssRules)
              .map((r: any) => r.cssText)
              .join('\n');
            doc.head.appendChild(style);
          }
        } catch (_) {
          if (sheet.href) {
            const link = doc.createElement('link');
            link.rel = 'stylesheet';
            link.href = sheet.href;
            doc.head.appendChild(link);
          }
        }
      });

      // 3. Mount Mini Player UI container
      const container = doc.createElement('div');
      container.id = 'lumen-pip-root';
      container.style.cssText = `
        width: 100%;
        height: 100%;
        padding: 16px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        background: radial-gradient(circle at 50% 20%, ${dominantColor}25 0%, #06070B 80%);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: inset 0 1px 1px 0 rgba(255, 255, 255, 0.2);
        transition: background 300ms ease;
      `;
      doc.body.appendChild(container);
      this.containerEl = container;

      // Render initial state
      this.update(track, isPlaying, onTogglePlay, onNext, onPrev, dominantColor);

      // Clean up on close
      pip.addEventListener('pagehide', () => {
        this.pipWindow = null;
        this.containerEl = null;
        this.isOpenState = false;
      });

      return true;
    } catch (err) {
      console.warn('[PipService] Failed to open Document PiP:', err);
      return false;
    }
  }

  public static update(
    track: Track | null,
    isPlaying: boolean,
    onTogglePlay?: () => void,
    onNext?: () => void,
    onPrev?: () => void,
    dominantColor: string = '#00F0FF'
  ): void {
    if (!this.isOpen() || !this.containerEl) return;

    const artworkUrl = track?.artworkUrl || 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=300';
    const title = track?.title || 'Lumen Player';
    const artist = track?.artist || 'Ready to Play';

    this.containerEl.style.background = `radial-gradient(circle at 50% 20%, ${dominantColor}30 0%, #06070B 80%)`;

    this.containerEl.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; margin-bottom:8px;">
        <span style="font-size:10px; font-weight:800; letter-spacing:0.1em; color:rgba(255,255,255,0.6); text-transform:uppercase;">
          LUMEN LIQUID PIP
        </span>
        <span style="font-size:9px; font-weight:700; padding:2px 8px; border-radius:12px; background:rgba(255,255,255,0.1); color:${dominantColor}; border:1px solid rgba(255,255,255,0.15);">
          HI-FI 320K
        </span>
      </div>

      <div style="width:180px; height:180px; border-radius:24px; overflow:hidden; box-shadow:0 12px 35px rgba(0,0,0,0.8), 0 0 30px ${dominantColor}30; border:1px solid rgba(255,255,255,0.15); margin: 6px 0;">
        <img src="${artworkUrl}" style="width:100%; height:100%; object-fit:cover;" alt="Art" />
      </div>

      <div style="text-align:center; width:100%; padding:0 8px;">
        <div style="font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#fff;">
          ${title}
        </div>
        <div style="font-size:12px; color:rgba(255,255,255,0.6); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">
          ${artist}
        </div>
      </div>

      <div style="display:flex; align-items:center; justify-content:center; gap:16px; margin-top:10px; width:100%;">
        <button id="pip-prev-btn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; width:36px; height:36px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px;">
          ⏮
        </button>

        <button id="pip-play-btn" style="background:${dominantColor}; border:none; color:#000; width:48px; height:48px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 0 20px ${dominantColor}60; font-weight:bold;">
          ${isPlaying ? '⏸' : '▶'}
        </button>

        <button id="pip-next-btn" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; width:36px; height:36px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:14px;">
          ⏭
        </button>
      </div>
    `;

    // Hook listeners
    const playBtn = this.containerEl.querySelector('#pip-play-btn');
    const nextBtn = this.containerEl.querySelector('#pip-next-btn');
    const prevBtn = this.containerEl.querySelector('#pip-prev-btn');

    if (playBtn && onTogglePlay) playBtn.addEventListener('click', onTogglePlay);
    if (nextBtn && onNext) nextBtn.addEventListener('click', onNext);
    if (prevBtn && onPrev) prevBtn.addEventListener('click', onPrev);
  }
}
