/**
 * LUMEN WAKE-WORD DETECTION SERVICE
 * Continuous foreground keyword spotter for hands-free "Hey Lumen" voice activation
 * with native microphone permission requesting, Web Audio chime synthesis, and auto-recovery.
 */

type WakeWordCallback = (initialCommand?: string) => void;

class WakeWordServiceClass {
  private isRunning = false;
  private recognition: any = null;
  private onWakeCallback: WakeWordCallback | null = null;
  private restartTimeout: any = null;
  private audioCtx: AudioContext | null = null;

  private readonly KEYWORDS = ['hey lumen', 'lumen', 'hay lumen', 'hi lumen', 'ok lumen', 'okay lumen'];

  /**
   * Whether wake-word listening is enabled in settings
   */
  public isEnabled(): boolean {
    if (typeof localStorage === 'undefined') return true;
    try {
      const val = localStorage.getItem('lumen_wake_word_enabled');
      return val !== 'false';
    } catch (_) {
      return true;
    }
  }

  /**
   * Set user preference
   */
  public setEnabled(enabled: boolean): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('lumen_wake_word_enabled', enabled ? 'true' : 'false');
      } catch (_) {}
    }
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  /**
   * Requests native microphone permission from browser or Android WebView
   */
  public async requestMicPermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop immediately after permission is granted
      stream.getTracks().forEach(track => track.stop());
      return true;
    } catch (err) {
      console.warn('[WakeWord] Microphone permission denied or unavailable:', err);
      return false;
    }
  }

  /**
   * Plays a subtle, high-fidelity two-tone wake confirmation chime
   */
  public playWakeChime(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = 'sine';
      // Pleasant upward harmonic chime (880Hz -> 1318.5Hz / A5 -> E6)
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1318.5, now + 0.12);

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (_) {}
  }

  /**
   * Registers callback for wake-word activation
   */
  public onWake(callback: WakeWordCallback): void {
    this.onWakeCallback = callback;
  }

  /**
   * Starts the continuous background keyword listener
   */
  public start(): void {
    if (this.isRunning || !this.isEnabled()) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.info('[WakeWord] Speech recognition not supported in this environment');
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => {
        this.isRunning = true;
      };

      this.recognition.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          const transcript = res[0]?.transcript?.trim().toLowerCase() || '';

          // Check if any keyword triggered
          for (const kw of this.KEYWORDS) {
            const idx = transcript.indexOf(kw);
            if (idx !== -1) {
              const commandAfterWake = transcript.slice(idx + kw.length).trim();
              console.info(`[WakeWord] "${kw}" detected! Command: "${commandAfterWake}"`);
              this.playWakeChime();

              // Temporarily pause background spotter so overlay takes over mic
              this.stop();

              if (this.onWakeCallback) {
                this.onWakeCallback(commandAfterWake || undefined);
              }
              return;
            }
          }
        }
      };

      this.recognition.onerror = (e: any) => {
        if (e.error !== 'no-speech') {
          console.warn('[WakeWord] Listener error:', e.error);
        }
      };

      this.recognition.onend = () => {
        this.isRunning = false;
        // Automatically restart after 500ms if still enabled
        if (this.isEnabled() && document.visibilityState !== 'hidden') {
          clearTimeout(this.restartTimeout);
          this.restartTimeout = setTimeout(() => {
            this.start();
          }, 600);
        }
      };

      this.recognition.start();
    } catch (err) {
      console.warn('[WakeWord] Failed to start speech recognizer:', err);
      this.isRunning = false;
    }
  }

  /**
   * Stops the keyword listener
   */
  public stop(): void {
    clearTimeout(this.restartTimeout);
    this.isRunning = false;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (_) {}
      this.recognition = null;
    }
  }
}

export const WakeWordService = new WakeWordServiceClass();
