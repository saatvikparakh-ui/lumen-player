import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, X, Sparkles, Volume2, Play, Pause, SkipForward, Music } from 'lucide-react';
import { GeminiService, VoiceCommandResult } from '../../services/geminiService';
import { Track } from '../../types/music';
import { AudioEngine } from '../../services/audioEngine';
import { StreamingService } from '../../services/streamingService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  dominantColor: string;
  currentTrack?: Track | null;
  isPlaying: boolean;
  onPlayTrack: (track: Track) => void;
  onNextTrack: () => void;
  onPrevTrack: () => void;
  onTogglePlay: () => void;
}

export const VoiceAgentOverlay: React.FC<Props> = ({
  isOpen,
  onClose,
  dominantColor,
  currentTrack,
  isPlaying,
  onPlayTrack,
  onNextTrack,
  onPrevTrack,
  onTogglePlay
}) => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [waveformBars, setWaveformBars] = useState<number[]>([20, 35, 60, 45, 80, 50, 65, 30, 20]);
  const recognitionRef = useRef<any>(null);

  // Animate waveform during listening
  useEffect(() => {
    let interval: any;
    if (isListening) {
      interval = setInterval(() => {
        setWaveformBars(prev => prev.map(() => Math.floor(Math.random() * 65) + 20));
      }, 100);
    } else {
      setWaveformBars([20, 20, 20, 20, 20, 20, 20, 20, 20]);
    }
    return () => clearInterval(interval);
  }, [isListening]);

  // Speech Recognition setup
  useEffect(() => {
    if (!isOpen) {
      stopListening();
      setTranscript('');
      setAiResponse(null);
      return;
    }

    startListening();
    return () => stopListening();
  }, [isOpen]);

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setAiResponse('Speech recognition not supported in this browser. You can type commands in search!');
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }

      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = 'en-US';

      rec.onstart = () => {
        setIsListening(true);
        setTranscript('Listening for music commands...');
        setAiResponse(null);
      };

      rec.onresult = (e: any) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
        }
        setTranscript(text);
      };

      rec.onerror = (e: any) => {
        console.warn('[VoiceAgent] Speech error:', e);
        setIsListening(false);
        if (e.error !== 'no-speech') {
          setAiResponse(`Mic error: ${e.error}`);
        }
      };

      rec.onend = () => {
        setIsListening(false);
      };

      rec.start();
      recognitionRef.current = rec;
    } catch (err) {
      console.warn('[VoiceAgent] Start error:', err);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (_) {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  };

  // When speech recognition ends and we have words, interpret them
  useEffect(() => {
    if (!isListening && transcript && transcript !== 'Listening for music commands...' && !isProcessing) {
      handleExecuteCommand(transcript);
    }
  }, [isListening, transcript]);

  const handleExecuteCommand = async (userWords: string) => {
    setIsProcessing(true);
    setAiResponse('Lumen AI DJ thinking...');

    try {
      const res: VoiceCommandResult = await GeminiService.interpretVoiceCommand(userWords, currentTrack);
      setAiResponse(res.spokenReply);

      // Execute corresponding player action
      if (res.action === 'play') {
        if (!isPlaying) onTogglePlay();
      } else if (res.action === 'pause') {
        if (isPlaying) onTogglePlay();
      } else if (res.action === 'next') {
        onNextTrack();
      } else if (res.action === 'prev') {
        onPrevTrack();
      } else if (res.action === 'volume' && res.volumeLevel !== undefined) {
        AudioEngine.setVolume(res.volumeLevel / 100);
      } else if (res.action === 'search_and_play' && res.query) {
        setAiResponse(`Finding "${res.query}" on YouTube...`);
        const results = await StreamingService.searchTracks(res.query);
        if (results && results.length > 0) {
          onPlayTrack(results[0]);
          setAiResponse(`Playing ${results[0].title} by ${results[0].artist}`);
        } else {
          setAiResponse(`Could not find "${res.query}"`);
        }
      } else if (res.action === 'recommend_mood') {
        const query = res.query || userWords;
        const mix = await GeminiService.generateAiMix(query, currentTrack);
        if (mix.tracks.length > 0) {
          const first = mix.tracks[0];
          const results = await StreamingService.searchTracks(`${first.title} ${first.artist}`);
          if (results.length > 0) {
            onPlayTrack(results[0]);
            setAiResponse(`Playing ${first.title} for your vibe!`);
          }
        }
      }

      // Auto close after 2.5 seconds on success
      setTimeout(() => {
        onClose();
      }, 2500);
    } catch (e) {
      setAiResponse('Command processed');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-2xl animate-fade-in">
      <div 
        className="relative w-full max-w-sm rounded-3xl p-6 bg-[#0B0E17]/95 border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.9)] flex flex-col items-center text-center overflow-hidden"
        style={{ boxShadow: `0 0 50px ${dominantColor}25` }}
      >
        {/* Glow ambient background */}
        <div 
          className="absolute -top-20 left-1/2 -translate-x-1/2 w-48 h-48 rounded-full blur-3xl pointer-events-none opacity-40"
          style={{ backgroundColor: dominantColor }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-white/50 hover:text-white rounded-full bg-white/5 active:scale-95 transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <Sparkles className="w-4 h-4" style={{ color: dominantColor }} />
          <span className="text-xs font-semibold tracking-wider uppercase text-white/60">
            Lumen Voice DJ
          </span>
        </div>

        {/* Pulsing Animated Waveform Ring */}
        <div className="relative my-4 flex items-center justify-center">
          <div 
            className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 ${
              isListening ? 'scale-110' : 'scale-100'
            }`}
            style={{ 
              backgroundColor: `${dominantColor}15`,
              border: `2px solid ${isListening ? dominantColor : 'rgba(255,255,255,0.1)'}`,
              boxShadow: isListening ? `0 0 35px ${dominantColor}50` : 'none'
            }}
          >
            {isListening ? (
              <Mic className="w-10 h-10 animate-pulse" style={{ color: dominantColor }} />
            ) : isProcessing ? (
              <Sparkles className="w-10 h-10 animate-spin" style={{ color: dominantColor }} />
            ) : (
              <MicOff className="w-10 h-10 text-white/40" />
            )}
          </div>
        </div>

        {/* Sound Wave Bars */}
        <div className="flex items-center justify-center gap-1.5 h-12 my-2 w-full max-w-[200px]">
          {waveformBars.map((height, idx) => (
            <div
              key={idx}
              className="w-1.5 rounded-full transition-all duration-100"
              style={{
                height: `${height}%`,
                backgroundColor: isListening ? dominantColor : 'rgba(255,255,255,0.2)'
              }}
            />
          ))}
        </div>

        {/* Transcript / Spoken text */}
        <div className="min-h-[50px] flex items-center justify-center my-2 px-2">
          <p className="text-sm font-medium text-white/90 italic">
            "{transcript || 'Listening...'}"
          </p>
        </div>

        {/* AI Reply Bubble */}
        {aiResponse && (
          <div 
            className="w-full py-2.5 px-4 rounded-xl text-xs font-medium text-white bg-white/5 border border-white/10 mt-2 animate-slide-up flex items-center justify-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: dominantColor }} />
            <span>{aiResponse}</span>
          </div>
        )}

        {/* Voice Command Hints */}
        <div className="mt-6 pt-4 border-t border-white/5 w-full flex flex-wrap justify-center gap-1.5 text-[10px] text-white/40">
          <span className="px-2 py-0.5 rounded-full bg-white/5">"Pause"</span>
          <span className="px-2 py-0.5 rounded-full bg-white/5">"Skip"</span>
          <span className="px-2 py-0.5 rounded-full bg-white/5">"Play The Weeknd"</span>
          <span className="px-2 py-0.5 rounded-full bg-white/5">"Volume 80%"</span>
        </div>
      </div>
    </div>
  );
};
