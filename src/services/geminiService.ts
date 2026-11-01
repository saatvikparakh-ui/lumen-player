/**
 * LUMEN GEMINI AI SERVICE
 * Powers the Interactive AI Voice DJ, smart voice commands,
 * conversational music discovery, and hyper-personalized AI song recommendations.
 */

import { AudioEngine } from './audioEngine';
import { StreamingService } from './streamingService';
import { Track } from '../types/music';

export interface VoiceCommandResult {
  action: 'play' | 'pause' | 'next' | 'prev' | 'volume' | 'search_and_play' | 'recommend_mood' | 'unknown';
  query?: string;
  volumeLevel?: number;
  spokenReply: string;
}

export interface AiCuratedMix {
  title: string;
  vibe: string;
  tracks: Array<{ title: string; artist: string; reason?: string }>;
}

const STORAGE_KEY_GEMINI_KEY = 'lumen_gemini_api_key';

// Default embedded key placeholder (overridable via localStorage or .env)
const DEFAULT_GEMINI_KEY = (import.meta as any)?.env?.VITE_GEMINI_API_KEY || '';

class GeminiServiceClass {
  private activeApiKey: string = DEFAULT_GEMINI_KEY;

  constructor() {
    this.loadSavedKey();
  }

  private loadSavedKey() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(STORAGE_KEY_GEMINI_KEY);
        if (saved && saved.trim()) {
          this.activeApiKey = saved.trim();
        }
      }
    } catch (_) {}
  }

  public getApiKey(): string {
    return this.activeApiKey || DEFAULT_GEMINI_KEY;
  }

  public setApiKey(key: string): void {
    this.activeApiKey = key.trim();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY_GEMINI_KEY, this.activeApiKey);
      }
    } catch (_) {}
  }

  public hasApiKey(): boolean {
    return !!(this.activeApiKey && this.activeApiKey.length > 10);
  }

  /**
   * Interprets spoken voice input using Gemini into executable music player actions
   */
  public async interpretVoiceCommand(transcript: string, currentTrack?: Track | null): Promise<VoiceCommandResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      // Local fallback parser for basic offline commands when no key is set yet
      return this.fallbackLocalVoiceParser(transcript);
    }

    const systemPrompt = `You are Lumen Voice DJ, a music player assistant.
The user is speaking music commands or asking for songs.
Currently playing track: "${currentTrack ? `${currentTrack.title} by ${currentTrack.artist}` : 'None'}".

You must return a single JSON object with:
- "action": one of ["play", "pause", "next", "prev", "volume", "search_and_play", "recommend_mood", "unknown"]
- "query": search query or song/artist name if searching (clean artist - title)
- "volumeLevel": number from 0 to 100 if user mentioned volume
- "spokenReply": short friendly phrase to show the listener (max 12 words, e.g. "Playing Bohemian Rhapsody by Queen now")

JSON ONLY. No markdown formatting.`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: `${systemPrompt}\n\nUser said: "${transcript}"` }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 200
          }
        })
      });

      if (!res.ok) {
        return this.fallbackLocalVoiceParser(transcript);
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      return {
        action: parsed.action || 'unknown',
        query: parsed.query,
        volumeLevel: parsed.volumeLevel,
        spokenReply: parsed.spokenReply || `Command: ${transcript}`
      };
    } catch (e) {
      console.warn('[Gemini Voice] AI interpretation error, using local fallback:', e);
      return this.fallbackLocalVoiceParser(transcript);
    }
  }

  /**
   * Fast local regex parser fallback if network fails or API key is pending
   */
  private fallbackLocalVoiceParser(transcript: string): VoiceCommandResult {
    const t = transcript.toLowerCase().trim();
    if (t.includes('pause') || t.includes('stop') || t.includes('wait') || t.includes('hold on')) {
      return { action: 'pause', spokenReply: 'Pausing music' };
    }
    if (t.includes('play') || t.includes('resume') || t.includes('start') || t.includes('unpause')) {
      if (t.startsWith('play ') && t.length > 5) {
        const query = transcript.replace(/play/i, '').trim();
        return { action: 'search_and_play', query, spokenReply: `Searching for "${query}"` };
      }
      return { action: 'play', spokenReply: 'Resuming playback' };
    }
    if (t.includes('next') || t.includes('skip') || t.includes('next song') || t.includes('forward')) {
      return { action: 'next', spokenReply: 'Skipping to next track' };
    }
    if (t.includes('previous') || t.includes('prev') || t.includes('back') || t.includes('last song')) {
      return { action: 'prev', spokenReply: 'Playing previous track' };
    }
    if (t.includes('volume')) {
      const match = t.match(/\d+/);
      const val = match ? Math.min(100, Math.max(0, parseInt(match[0], 10))) : 70;
      return { action: 'volume', volumeLevel: val, spokenReply: `Setting volume to ${val}%` };
    }
    if (t.length > 2) {
      return { action: 'search_and_play', query: transcript, spokenReply: `Finding "${transcript}"` };
    }
    return { action: 'unknown', spokenReply: "Didn't catch that command" };
  }

  /**
   * Generates AI curated recommendation songs based on prompt or mood
   */
  public async generateAiMix(prompt: string, currentTrack?: Track | null): Promise<AiCuratedMix> {
    const apiKey = this.getApiKey();
    const system = `You are Lumen Music AI DJ.
Generate a custom 8-track playlist for the user's prompt: "${prompt}".
${currentTrack ? `Currently listening to: ${currentTrack.title} by ${currentTrack.artist}` : ''}

Output JSON only in this format:
{
  "title": "Mix Title (catchy, 3-5 words)",
  "vibe": "Short mood description",
  "tracks": [
    { "title": "Song Title", "artist": "Artist Name", "reason": "why this matches" }
  ]
}`;

    if (!apiKey) {
      return {
        title: `${prompt.slice(0, 20)} Mix`,
        vibe: prompt,
        tracks: [
          { title: "Starboy", artist: "The Weeknd" },
          { title: "Blinding Lights", artist: "The Weeknd" },
          { title: "Nightcall", artist: "Kavinsky" },
          { title: "Midnight City", artist: "M83" },
          { title: "After Hours", artist: "The Weeknd" }
        ]
      };
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: system }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      console.warn('[Gemini AI Mix] Generation error:', err);
      return {
        title: `${prompt} Curations`,
        vibe: 'Personalized mix',
        tracks: [
          { title: "As It Was", artist: "Harry Styles" },
          { title: "Levitating", artist: "Dua Lipa" },
          { title: "Save Your Tears", artist: "The Weeknd" }
        ]
      };
    }
  }
}

export const GeminiService = new GeminiServiceClass();
