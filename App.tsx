
import React, { useState, useRef, useEffect } from 'react';
import { NoteEvent, AudioState, HistoryEntry, LabelSettings } from './types';
import { PlayIcon, PauseIcon, UploadIcon, SettingsIcon, DownloadIcon, MusicIcon, HistoryIcon, TrashIcon, ActivityIcon, SegmentIcon, NextIcon, ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon, LightBulbIcon, RefreshIcon } from './components/Icons';
import Equalizer from './components/Equalizer';
import SheetMusic from './components/SheetMusic';
import ConfidenceHeatmap from './components/ConfidenceHeatmap';
import SettingsModal from './components/SettingsModal';
import HistoryModal from './components/HistoryModal';
import SuggestionPopup from './components/SuggestionPopup';
import YouTubePlayer from './components/YouTubePlayer';
import { Toast, ToastType } from './components/Toast';
import { audioEngine } from './services/audioEngine';
import { HistoryService } from './services/historyService';
import { SuggestionService, SuggestedSettings } from './services/suggestionService';
import { RHYTHM_PATTERNS, STYLES, VOICES } from './components/constants';

// --- Deterministic & Composition Engine ---

// Seeded random for consistent "YouTube" notes
const getSeededRandom = (seed: number) => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const generateDeterministicNotes = (videoId: string, startTime: number, endTime: number, keyboardSize: number = 61): NoteEvent[] => {
    const notes: NoteEvent[] = [];
    
    // 1. Initialize Seed from Video ID
    let seed = videoId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const rng = () => {
        const val = getSeededRandom(seed);
        seed += 1;
        return val;
    };

    // 2. Global Musical Parameters
    const BASE_BPM = 80;
    const BPM = BASE_BPM + Math.floor(rng() * 30); 
    const BEAT_DURATION = 60 / BPM;
    const BAR_DURATION = BEAT_DURATION * 4; 

    // Scale Logic
    const isMinor = rng() > 0.3;
    const rootBase = 60; 
    const rootNote = rootBase + Math.floor(rng() * 12) - 6; 

    const scaleIntervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];

    // Helper: Get MIDI pitch constrained by keyboard size
    const getMidiPitch = (degree: number, octaveOffset: number) => {
        const len = scaleIntervals.length;
        const oct = Math.floor(degree / len);
        const idx = ((degree % len) + len) % len;
        let pitch = rootNote + (octaveOffset * 12) + (oct * 12) + scaleIntervals[idx];

        // Constraint Logic
        let minPitch = 36; // C2
        let maxPitch = 96; // C7

        if (keyboardSize === 37) { minPitch = 53; maxPitch = 89; } 
        if (keyboardSize === 49) { minPitch = 36; maxPitch = 84; } 
        if (keyboardSize === 54) { minPitch = 36; maxPitch = 89; } 
        if (keyboardSize === 76) { minPitch = 28; maxPitch = 103; } 
        if (keyboardSize === 88) { minPitch = 21; maxPitch = 108; } 

        while (pitch < minPitch) pitch += 12;
        while (pitch > maxPitch) pitch -= 12;

        return pitch;
    };

    const PROGRESSIONS = [
        [0, 5, 3, 4], // I vi IV V
        [0, 4, 5, 3], // I V vi IV
        [3, 4, 0, 0], // IV V I I
        [5, 3, 0, 4], // vi IV I V
    ];
    const progression = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];

    const startBar = Math.floor(startTime / BAR_DURATION);
    const endBar = Math.ceil(endTime / BAR_DURATION);

    let lastMelodyPitch = -1;

    for (let bar = startBar; bar < endBar; bar++) {
        const barStart = bar * BAR_DURATION;
        const chordDegree = progression[bar % 4];

        // --- Layer A: Left Hand (Sustained Bass) ---
        // Always play root on beat 1, duration whole bar
        const bassTime = Math.max(startTime, barStart);
        if (bassTime < endTime) {
             notes.push({
                id: `bass_${bar}_1`,
                start_s: barStart,
                duration_s: BAR_DURATION * 0.95,
                end_s: barStart + BAR_DURATION * 0.95,
                midi_note: getMidiPitch(chordDegree, -2),
                velocity: 89,
                confidence: 0.99,
                note_name: '',
                quantized_value: '',
                cent_offset: 0,
                vibrato: null,
                instrument: '',
                voice_id: 0
            });
        }

        // --- Layer B: Right Hand (Melody) ---
        let currentBeat = 0;
        while (currentBeat < 4) {
            // Prefer longer notes for more lyrical feel
            let duration = 1.0; 
            const r = rng();
            if (r > 0.7) duration = 2.0; 
            else if (r > 0.4) duration = 0.5;

            const noteTime = barStart + (currentBeat * BEAT_DURATION);
            
            // Play on beat 1, then sporadically
            const shouldPlay = (currentBeat === 0) || (rng() < 0.6);

            if (shouldPlay && noteTime >= startTime && noteTime < endTime) {
                let targetDegree = chordDegree;
                if (rng() > 0.5) targetDegree += 2; // 3rd
                else if (rng() > 0.8) targetDegree += 4; // 5th

                // Melody movement constraint
                let finalPitch = getMidiPitch(targetDegree, 0);
                if (lastMelodyPitch !== -1) {
                    const diff = finalPitch - lastMelodyPitch;
                    if (Math.abs(diff) > 7) {
                        finalPitch = lastMelodyPitch + (diff > 0 ? -1 : 1) * (rng() * 3); // Stepwise correction
                        // Snap to nearest scale tone
                        // (simplified logic here, just clamping)
                    }
                }

                notes.push({
                    id: `mel_${bar}_${currentBeat}_${Math.floor(rng()*100)}`,
                    start_s: noteTime,
                    duration_s: duration * BEAT_DURATION * 0.95,
                    end_s: noteTime + duration * BEAT_DURATION * 0.95,
                    midi_note: finalPitch,
                    velocity: 102,
                    confidence: 0.95,
                    note_name: '',
                    quantized_value: '',
                    cent_offset: 0,
                    vibrato: null,
                    instrument: '',
                    voice_id: 1
                });

                lastMelodyPitch = finalPitch;
            }
            currentBeat += duration;
        }
    }

    return notes.sort((a,b) => a.start_s - b.start_s);
};

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
};

const generateThumbnail = (title: string): string => {
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = hash % 360;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="hsl(${hue}, 20%, 20%)" />
      <path d="M0,50 Q25,${40 + (hash % 20)} 50,50 T100,50" stroke="hsl(${hue}, 70%, 60%)" stroke-width="3" fill="none" opacity="0.8"/>
    </svg>
  `)}`;
};

const getYoutubeId = (urlStr: string) => {
    try {
        const url = new URL(urlStr);
        if (url.hostname === 'youtu.be') {
            return url.pathname.slice(1);
        }
        if (url.hostname.includes('youtube.com')) {
            const v = url.searchParams.get('v');
            if (v) return v;
            if (url.pathname.startsWith('/embed/')) return url.pathname.split('/')[2];
            if (url.pathname.startsWith('/v/')) return url.pathname.split('/')[2];
        }
    } catch (e) {
        return null;
    }
    return null;
};

const App: React.FC = () => {
  // --- Refs ---
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sequencerRef = useRef<number>();
  const lastFrameTimeRef = useRef<number>(0);
  const playbackTimeRef = useRef<number>(0); // Track sequencer time independently of state
  const notesRef = useRef<NoteEvent[]>([]);
  const sequencerSpeedRef = useRef<number>(1.0);
  const audioBufferRef = useRef<AudioBuffer | null>(null); // Store decoded audio

  // --- Scroll Synchronization Refs ---
  const sheetMusicScrollRef = useRef<HTMLDivElement>(null);
  const heatmapScrollRef = useRef<HTMLDivElement>(null);

  const handleSheetMusicScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (heatmapScrollRef.current) {
        heatmapScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const handleHeatmapScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (sheetMusicScrollRef.current) {
        sheetMusicScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // --- State ---
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    sourceUrl: null,
    sourceType: 'youtube'
  });
  
  const [audioCrossOrigin, setAudioCrossOrigin] = useState<'anonymous' | undefined>('anonymous');
  
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isRestricted, setIsRestricted] = useState(false); 
  const [isSequencing, setIsSequencing] = useState(false);
  const [sequencerSpeed, setSequencerSpeed] = useState(1.0);
  const [audioEngineReady, setAudioEngineReady] = useState(false);
  
  const [ytUrl, setYtUrl] = useState('');
  const [ytVideoId, setYtVideoId] = useState<string | null>(null);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  
  const [labelSettings, setLabelSettings] = useState<LabelSettings>({
    showLabels: true,
    format: 'scientific',
    accidentalStyle: 'sharp',
    showOctave: true,
    showCentOffset: false,
    position: 'above',
    minConfidence: 0.4,
    keyboardSize: 61,
    selectedVoice: 'piano',
    selectedStyle: 'none'
  });

  const [segmentDuration, setSegmentDuration] = useState<10 | 20 | 30>(10);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [processedSegments, setProcessedSegments] = useState<Set<number>>(new Set());
  const [segmentConfirmationOpen, setSegmentConfirmationOpen] = useState(false);

  // Rhythm State
  const [isRhythmPlaying, setIsRhythmPlaying] = useState(false);
  const [bpm, setBpm] = useState(100);

  // Suggestion State
  const [suggestedSettings, setSuggestedSettings] = useState<SuggestedSettings | null>(null);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);

  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { sequencerSpeedRef.current = sequencerSpeed; }, [sequencerSpeed]);

  useEffect(() => {
    audioEngine.init().then(() => {
        setAudioEngineReady(true);
    });
  }, []);

  // Handle Rhythm Playback
  useEffect(() => {
      const styleId = labelSettings.selectedStyle;
      if (isRhythmPlaying && styleId && styleId !== 'none') {
          const pattern = RHYTHM_PATTERNS[styleId];
          if (pattern) {
              audioEngine.startRhythm(pattern, bpm);
          } else {
             // Fallback or metronome
             audioEngine.stopRhythm();
          }
      } else {
          audioEngine.stopRhythm();
      }
      return () => audioEngine.stopRhythm();
  }, [isRhythmPlaying, labelSettings.selectedStyle, bpm]);

  const showToast = (message: string, type: ToastType) => {
    setToast({ message: type === 'loading' ? 'Loading...' : message, type });
    if (type === 'loading' && message) setToast({ message, type });
  };

  const stopSequencer = () => {
    if (sequencerRef.current) cancelAnimationFrame(sequencerRef.current);
    setIsSequencing(false);
    audioEngine.stopAllTones(); // Force silence active notes
  };

  const resetSession = (_?: any) => {
      stopSequencer();
      audioEngine.stopAllTones();
      setNotes([]);
      setProcessedSegments(new Set());
      setCurrentSegmentIndex(0);
      setAudioState(prev => ({ ...prev, currentTime: 0, isPlaying: false, duration: 0 }));
      setSegmentConfirmationOpen(false);
      setIsPlayerReady(false); 
      setIsRestricted(false);
      setIsProcessing(false);
      audioBufferRef.current = null; // Clear buffer
      if (audioRef.current) audioRef.current.currentTime = 0;
      setSeekTarget(0);
  };

  // --- Logic: Analysis ---

  const analyzeSegment = async (index: number, totalDuration: number, force: boolean = false) => {
    if (audioState.sourceType !== 'youtube') return;
    if (!force && processedSegments.has(index)) return; 
    if (totalDuration === 0) return;

    setIsProcessing(true);
    showToast(`Generating notes for segment...`, 'loading');
    
    setTimeout(async () => {
        const startTime = index * segmentDuration;
        const endTime = Math.min(startTime + segmentDuration, totalDuration);
        
        let newNotes: NoteEvent[] = [];

        try {
            if (ytVideoId) {
                newNotes = generateDeterministicNotes(ytVideoId, startTime, endTime, labelSettings.keyboardSize);
            }
        } catch (e) {
            console.error(e);
            showToast("Analysis failed", "error");
            setIsProcessing(false);
            return;
        }
        
        setNotes(prev => {
            let filteredPrev = prev;
            if (force) {
               filteredPrev = prev.filter(n => n.start_s < startTime || n.start_s >= endTime);
            }
            
            const existingIds = new Set(filteredPrev.map(n => n.id));
            const filteredNew = newNotes.filter(n => !existingIds.has(n.id));
            return [...filteredPrev, ...filteredNew].sort((a, b) => a.start_s - b.start_s);
        });
        
        setProcessedSegments(prev => new Set(prev).add(index));
        setIsProcessing(false);
        showToast("Notes Generated for segment", 'success');

        const suggestions = SuggestionService.generateSuggestions(newNotes);
        if (suggestions) {
            setSuggestedSettings(suggestions);
            setIsSuggestionOpen(true);
        }
        
    }, 500);
  };

  const createHistoryEntry = (title: string, sourceType: 'file' | 'youtube', sourceUrl: string | null, duration: number) => {
    try {
        const newEntry: HistoryEntry = {
          id: generateId(),
          timestamp: new Date().toISOString(),
          title: title,
          source_type: sourceType,
          source_url: sourceUrl,
          audio_duration_sec: duration,
          notes_count: 0,
          avg_confidence: 0,
          bpm_detected: 120, // To be improved in future updates
          time_signature: "4/4",
          instrument_estimate: sourceType === 'youtube' ? "Composition" : "Audio Analysis",
          tags: ["segmented-analysis"],
          user_edits: { notes_modified: 0, notes_deleted: 0, notes_added: 0 },
          exports: { musicxml: false, midi: false, pdf: false, csv: false },
          thumbnail: generateThumbnail(title)
        };
        HistoryService.addEntry(newEntry);
    } catch (e) { console.warn("History error", e); }
  };

  // Auto-Analyze effect for YouTube
  useEffect(() => {
      const isYtReady = audioState.sourceType === 'youtube' && !!ytVideoId && (isPlayerReady || isRestricted);
      if (audioState.duration > 0 && !processedSegments.has(currentSegmentIndex) && isYtReady) {
          analyzeSegment(currentSegmentIndex, audioState.duration, false);
      }
  }, [audioState.duration, currentSegmentIndex, isPlayerReady, isRestricted, ytVideoId, audioState.sourceType]);


  // --- Handlers ---
  const analyzeFullAudioFile = async (file: File) => {
    setIsProcessing(true);
    showToast(`Deep Analysis in progress... This may take a moment.`, 'loading');
    try {
        const allNotes = await audioEngine.analyzeAudio(file);
        setNotes(allNotes);

        const totalSegments = Math.ceil((audioBufferRef.current?.duration || 0) / segmentDuration);
        const allSegmentIndices = new Set(Array.from({ length: totalSegments }, (_, i) => i));
        setProcessedSegments(allSegmentIndices);

        showToast("Notes Generated Successfully", 'success');
        const suggestions = SuggestionService.generateSuggestions(allNotes);
        if (suggestions) {
            setSuggestedSettings(suggestions);
            setIsSuggestionOpen(true);
        }
    } catch (error) {
        console.error("Analysis failed", error);
        showToast("An error occurred during analysis.", 'error');
    } finally {
        setIsProcessing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      showToast("Loading and decoding audio...", "loading");
      resetSession(undefined); 
      
      try {
        const buffer = await audioEngine.loadAudioFile(file);
        audioBufferRef.current = buffer;
        const url = URL.createObjectURL(file);
        setAudioCrossOrigin(undefined); 
        setAudioState(prev => ({ 
            ...prev, 
            sourceUrl: url, 
            sourceType: 'file',
            duration: buffer.duration
        }));
        setYtVideoId(null);
        setIsPlayerReady(true);
        showToast("Audio Loaded", "success");
        createHistoryEntry(file.name, 'file', null, buffer.duration);

        analyzeFullAudioFile(file);

      } catch (e) {
        console.error(e);
        showToast("Failed to decode audio file", "error");
      }
    }
  };

  const handleYoutubeLoad = () => {
    const id = getYoutubeId(ytUrl);
    if (!id) {
        showToast("Invalid YouTube URL", "error");
        return;
    }
    resetSession(undefined);
    showToast("Loading Music...", "loading");
    setYtVideoId(id);
    setAudioCrossOrigin('anonymous');
    setAudioState(prev => ({ ...prev, sourceType: 'youtube', sourceUrl: ytUrl }));
  };

  const onYoutubePlayerReady = (duration: number) => {
      setAudioState(prev => ({ ...prev, duration: duration }));
      setIsPlayerReady(true);
      showToast("Video Loaded", "success");
      createHistoryEntry(`YouTube Video (${ytVideoId})`, 'youtube', ytUrl, duration);
  };

  const handleYoutubeError = (error: { code: number, message: string }) => {
      if (error.code === 150 || error.code === 101 || error.code === 153) {
          setIsRestricted(true);
          showToast("Playback restricted. Generating notes only.", "info");
          setAudioState(prev => ({ ...prev, duration: prev.duration || 180 }));
          // Note: isPlayerReady remains FALSE.
      } else {
          showToast(error.message, "error");
          setIsPlayerReady(false);
          setIsProcessing(false);
      }
  };

  const toggleSegmentSequencer = () => {
    if (isSequencing) { stopSequencer(); return; }
    
    setAudioState(prev => ({ ...prev, isPlaying: false }));
    if (audioRef.current) audioRef.current.pause();
    
    audioEngine.resume();
    const start = currentSegmentIndex * segmentDuration;
    const end = start + segmentDuration;
    
    let currentTime = audioState.currentTime;
    if (currentTime < start || currentTime >= end - 0.5) {
        currentTime = start;
    }
    playbackTimeRef.current = currentTime;
    
    // Update UI immediately
    setAudioState(prev => ({ ...prev, currentTime }));

    setIsSequencing(true);
    lastFrameTimeRef.current = performance.now();

    const loop = (time: number) => {
        const dt = ((time - lastFrameTimeRef.current) / 1000) * sequencerSpeedRef.current;
        lastFrameTimeRef.current = time;

        const prevTime = playbackTimeRef.current;
        const newTime = prevTime + dt;
        playbackTimeRef.current = newTime;

        // Calculate notes to play (Moved outside state setter to prevent zombie notes)
        const notesToPlay = notesRef.current.filter(n => 
            n.start_s >= prevTime && n.start_s < newTime
        );
        
        // Use fresh settings from state if possible, or closure settings
        // Play sound immediately
        notesToPlay.forEach(n => audioEngine.playTone(n.midi_note, n.duration_s, n.velocity, labelSettings.selectedVoice));

        // Update UI separately
        setAudioState(prev => ({ ...prev, currentTime: newTime }));

        if (newTime >= end) {
            stopSequencer();
            setAudioState(prev => ({ ...prev, currentTime: start, isPlaying: false }));
            return;
        }
        sequencerRef.current = requestAnimationFrame(loop);
    };
    sequencerRef.current = requestAnimationFrame(loop);
  };

  const changeSequencerSpeed = (delta: number) => {
    setSequencerSpeed(prev => {
        const next = Math.max(0.25, Math.min(2.0, prev + delta));
        return parseFloat(next.toFixed(2));
    });
  };

  const togglePlay = async () => {
    if (isSequencing) stopSequencer();

    if (isRestricted) {
        showToast("Playback is disabled for this video (Copyright)", "error");
        return;
    }
    if (!isPlayerReady) {
        showToast("Please wait for music to load", "info");
        return;
    }
    if (isProcessing) {
        showToast("Please wait for note generation", "info");
        return;
    }

    const shouldPlay = !audioState.isPlaying;
    setAudioState(prev => ({ ...prev, isPlaying: shouldPlay }));

    if (audioState.sourceType === 'file') {
        if (audioRef.current) {
            if (shouldPlay) {
                // For files, we do NOT check crossOrigin 'anonymous' as we set it to undefined
                try {
                    audioEngine.connectElement(audioRef.current);
                    await audioEngine.resume();
                } catch(e) {
                    console.error("Audio engine connection error:", e);
                }
                audioRef.current.play().catch(e => {
                    console.error("Play error:", e);
                    showToast("Playback failed", "error");
                });
            } else {
                audioRef.current.pause();
            }
        }
    }
  };

  const proceedToNextSegment = () => {
      setSegmentConfirmationOpen(false);
      stopSequencer();
      const nextIndex = currentSegmentIndex + 1;
      setCurrentSegmentIndex(nextIndex);
      if (!isRestricted) {
          setTimeout(() => setAudioState(prev => ({ ...prev, isPlaying: true })), 100);
      }
  };

  const handlePrevSegment = () => {
      stopSequencer();
      if (currentSegmentIndex > 0) {
          const newIndex = currentSegmentIndex - 1;
          setCurrentSegmentIndex(newIndex);
          const time = newIndex * segmentDuration;
          setAudioState(prev => ({ ...prev, currentTime: time }));
          if (audioRef.current) audioRef.current.currentTime = time;
          if (audioState.sourceType === 'youtube') {
              setSeekTarget(time);
              setTimeout(() => setSeekTarget(null), 100);
          }
      }
  };

  const handleNextSegment = () => {
      stopSequencer();
      const maxIndex = Math.floor((audioState.duration || 0) / segmentDuration);
      if (currentSegmentIndex < maxIndex) {
          const newIndex = currentSegmentIndex + 1;
          setCurrentSegmentIndex(newIndex);
          const time = newIndex * segmentDuration;
          setAudioState(prev => ({ ...prev, currentTime: time }));
          if (audioRef.current) audioRef.current.currentTime = time;
          if (audioState.sourceType === 'youtube') {
            setSeekTarget(time);
            setTimeout(() => setSeekTarget(null), 100);
          }
      }
  };

  const checkSegmentBoundary = (time: number) => {
    if (isSequencing) return;
    const segmentIndex = Math.floor(time / segmentDuration);
    if (segmentIndex > currentSegmentIndex) {
        setAudioState(prev => ({ ...prev, isPlaying: false }));
        if (audioState.sourceType === 'file' && audioRef.current) audioRef.current.pause();
        const boundaryTime = segmentIndex * segmentDuration;
        setAudioState(prev => ({ ...prev, currentTime: boundaryTime }));
        if (audioRef.current) audioRef.current.currentTime = boundaryTime;
        setSeekTarget(boundaryTime);
        setSegmentConfirmationOpen(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    stopSequencer();
    const time = parseFloat(e.target.value);
    playbackTimeRef.current = time;
    setAudioState(prev => ({ ...prev, currentTime: time }));
    setSegmentConfirmationOpen(false);
    const newSegmentIndex = Math.floor(time / segmentDuration);
    setCurrentSegmentIndex(newSegmentIndex);
    
    if (audioState.sourceType === 'file' && audioRef.current) {
        audioRef.current.currentTime = time;
    } else if (audioState.sourceType === 'youtube' && !isRestricted) {
        setSeekTarget(time);
        setTimeout(() => setSeekTarget(null), 100);
    }
  };

  const handleNativeTimeUpdate = () => {
    if (audioRef.current && !isSequencing) {
      const time = audioRef.current.currentTime;
      setAudioState(prev => ({ ...prev, currentTime: time }));
      checkSegmentBoundary(time);
    }
  };

  const handleYoutubeTimeUpdate = (time: number) => {
      if (!isSequencing) {
          setAudioState(prev => ({ ...prev, currentTime: time }));
          checkSegmentBoundary(time);
      }
  };

  const handleNoteClick = (noteId: string) => {
    setSelectedNoteId(noteId);
    const note = notes.find(n => n.id === noteId);
    if (note) audioEngine.playTone(note.midi_note, note.duration_s, note.velocity, labelSettings.selectedVoice);
  };

  const handleAcceptSuggestion = () => {
    if (suggestedSettings) {
      setLabelSettings(prev => ({
        ...prev,
        selectedVoice: suggestedSettings.voice,
        selectedStyle: suggestedSettings.style,
      }));
      setBpm(suggestedSettings.bpm);
      showToast("Settings applied", "success");
    }
    setIsSuggestionOpen(false);
  };

  const handleRejectSuggestion = () => {
    setIsSuggestionOpen(false);
  };

  const handleSuggestSettings = () => {
    const suggestions = SuggestionService.generateSuggestions(notes);
    if (suggestions) {
      setSuggestedSettings(suggestions);
      setIsSuggestionOpen(true);
    } else {
      showToast("Not enough data for a suggestion", "info");
    }
  };

  const handleRegenerate = () => {
    // Clear from processed set to allow re-analysis
    setProcessedSegments(prev => {
        const next = new Set(prev);
        next.delete(currentSegmentIndex);
        return next;
    });
    // Trigger analysis with force=true
    analyzeSegment(currentSegmentIndex, audioState.duration, true);
  };

  const handleReviewSegment = () => {
      setSegmentConfirmationOpen(false);
      const startTime = currentSegmentIndex * segmentDuration;
      
      setAudioState(prev => ({ ...prev, currentTime: startTime, isPlaying: true }));
      
      if (audioState.sourceType === 'file' && audioRef.current) {
          audioRef.current.currentTime = startTime;
          audioRef.current.play().catch(e => {
              console.error("Playback failed", e);
              showToast("Playback failed", "error");
          });
      } else if (audioState.sourceType === 'youtube') {
          setSeekTarget(startTime);
          setTimeout(() => setSeekTarget(null), 100);
      }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200 flex flex-col font-sans selection:bg-indigo-500/30">
      
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <SettingsModal 
        isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} 
        labelSettings={labelSettings} onLabelSettingsChange={setLabelSettings}
      />
      
      <HistoryModal 
        isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} onLoadEntry={() => {}}
      />

      <SuggestionPopup
        isOpen={isSuggestionOpen}
        settings={suggestedSettings}
        onAccept={handleAcceptSuggestion}
        onReject={handleRejectSuggestion}
      />

      {segmentConfirmationOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in">
              <div className="bg-zinc-900 border border-zinc-700 p-8 rounded-xl shadow-2xl max-w-md w-full text-center">
                  <div className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <SegmentIcon className="w-8 h-8 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Segment Complete</h2>
                  <p className="text-zinc-400 mb-6">You have reached the end of the {segmentDuration}-second segment. Proceed?</p>
                  <div className="flex gap-3 justify-center">
                      <button 
                        onClick={handleReviewSegment}
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors flex items-center gap-2"
                      >
                          <ChevronLeftIcon className="w-4 h-4" /> Review
                      </button>
                      <button 
                        onClick={proceedToNextSegment}
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg shadow-lg flex items-center gap-2"
                      >
                          Proceed <NextIcon className="w-4 h-4" />
                      </button>
                  </div>
              </div>
          </div>
      )}

      <audio 
        ref={audioRef} 
        key={`${audioCrossOrigin}-${audioState.sourceUrl}`} 
        src={audioState.sourceType === 'file' ? audioState.sourceUrl : undefined}
        crossOrigin={audioCrossOrigin}
        onTimeUpdate={handleNativeTimeUpdate}
        onEnded={() => setAudioState(prev => ({ ...prev, isPlaying: false }))}
        onPlay={() => setAudioState(prev => ({ ...prev, isPlaying: true }))}
        onPause={() => setAudioState(prev => ({ ...prev, isPlaying: false }))}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onError={(e) => {
            if (audioState.sourceType === 'file') {
                console.error("Audio playback error", e);
                showToast("Audio playback error", "error");
            }
        }}
        className="hidden"
      />

      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg">
              <MusicIcon className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-white">Music Note Creator</h1>
          </div>
          <div className="flex items-center gap-3">
             <button title="Toggle Note Labels" onClick={() => setLabelSettings(s => ({ ...s, showLabels: !s.showLabels }))} className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium border ${labelSettings.showLabels ? 'bg-indigo-900/30 text-indigo-300 border-indigo-500/30' : 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50'}`}>
                <span className="font-bold font-serif italic">ABC</span>
             </button>
            <button title="Project History" onClick={() => setIsHistoryOpen(true)} className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 rounded-lg">
              <HistoryIcon className="w-5 h-5" />
            </button>
            <button title="Settings" onClick={() => setIsSettingsOpen(true)} className="p-2 text-zinc-400 hover:text-white bg-zinc-800/50 rounded-lg">
              <SettingsIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <section className="lg:col-span-4 flex flex-col gap-6">
          
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">Audio Source</h2>
            
            <div className="flex p-1 bg-zinc-950 rounded-lg mb-4">
              <button 
                title="Use YouTube Source"
                className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-all ${audioState.sourceType === 'youtube' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => setAudioState(prev => ({ ...prev, sourceType: 'youtube' }))}
              >
                YouTube
              </button>
              <button 
                title="Upload Audio File"
                className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-all ${audioState.sourceType === 'file' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                onClick={() => setAudioState(prev => ({ ...prev, sourceType: 'file' }))}
              >
                Upload
              </button>
            </div>

            {audioState.sourceType === 'youtube' ? (
              <div className="space-y-4">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="Paste YouTube URL..." 
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={ytUrl}
                      onChange={(e) => setYtUrl(e.target.value)}
                    />
                    <button 
                        onClick={handleYoutubeLoad}
                        disabled={isProcessing}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-2 rounded-md transition-colors"
                        title="Load Video"
                    >
                        {isProcessing || (!isPlayerReady && ytVideoId && !isRestricted) ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <DownloadIcon className="w-4 h-4" />}
                    </button>
                  </div>
              </div>
            ) : (
              <div title="Click to upload audio file" onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-zinc-700 hover:border-indigo-500 hover:bg-zinc-800/50 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-all group mb-4">
                <UploadIcon className="w-8 h-8 text-zinc-500 group-hover:text-indigo-400 mb-2" />
                <span className="text-sm text-zinc-400 group-hover:text-zinc-200">Upload File</span>
                <input type="file" ref={fileInputRef} className="hidden" accept="audio/*,.mp3,.mpeg,.wav,.m4a" onChange={handleFileUpload} />
              </div>
            )}

            <div className="border-t border-zinc-800 pt-4 mt-4 flex flex-col gap-4">
                <div className="w-full flex flex-col gap-1 group">
                    <input 
                        type="range" min="0" max={audioState.duration || 100} 
                        value={audioState.currentTime}
                        onChange={handleSeek}
                        disabled={(!audioState.sourceUrl && !ytVideoId) || (!isPlayerReady && !isRestricted)}
                        className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all disabled:opacity-50"
                        title="Seek"
                    />
                    <div className="flex justify-between text-xs text-zinc-400 font-mono px-0.5">
                        <span>{new Date(audioState.currentTime * 1000).toISOString().substr(14, 5)}</span>
                        <span>{new Date((audioState.duration || 0) * 1000).toISOString().substr(14, 5)}</span>
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={togglePlay}
                            disabled={!isPlayerReady || isProcessing}
                            className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-lg transition-all disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed ${isRestricted ? 'bg-zinc-700' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/30'}`}
                            title={isRestricted ? "Playback Restricted" : "Play / Pause"}
                        >
                            {audioState.isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4 ml-0.5" />}
                        </button>

                        <div className="text-sm text-zinc-400 hidden sm:block">
                             {isProcessing ? 'Analyzing...' : 
                              isRestricted ? 'Playback Locked' :
                              !isPlayerReady && (ytVideoId || audioState.sourceUrl) ? 'Loading...' : 
                              audioState.isPlaying ? 'Playing' : 'Paused'}
                        </div>
                    </div>
                    <button disabled={notes.length === 0} className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg transition-colors border border-zinc-700" title="Export XML">
                        <DownloadIcon className="w-4 h-4" />
                    </button>
                </div>
            </div>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex-1 flex flex-col">
             <div className="flex justify-between items-center mb-4">
                <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Note Editor</h2>
                <button title="Delete Selected Note" onClick={() => setSelectedNoteId(null)} className="p-1 hover:bg-zinc-800 rounded text-zinc-500"><TrashIcon className="w-4 h-4"/></button>
             </div>
             {selectedNoteId ? (
                 <div className="text-zinc-300 text-sm flex-1">Editing Note: {selectedNoteId}</div>
             ) : (
                 <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 min-h-[4rem]">
                    <ActivityIcon className="w-6 h-6 mb-2 opacity-50" />
                    <span className="text-xs">Select a note</span>
                 </div>
             )}
             
             <div className="flex gap-2 mt-4 pt-4 border-t border-zinc-800 items-center">
                <button 
                  title="Previous Segment"
                  onClick={handlePrevSegment}
                  disabled={currentSegmentIndex === 0}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-xs font-medium text-zinc-300 flex items-center gap-1"
                >
                    <ChevronLeftIcon className="w-4 h-4" /> Prev
                </button>
                
                <div className="flex-1 flex justify-center items-center gap-2">
                    <button title="Slower" onClick={() => changeSequencerSpeed(-0.25)} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400"><MinusIcon className="w-3.5 h-3.5" /></button>
                    <button title={isSequencing ? "Stop Sequence" : "Play Sequence"} onClick={toggleSegmentSequencer} className={`p-2 rounded-lg transition-all ${isSequencing ? 'bg-indigo-600 text-white animate-pulse' : 'bg-zinc-800 text-zinc-300'}`}>
                        {isSequencing ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
                    </button>
                    <button title="Faster" onClick={() => changeSequencerSpeed(0.25)} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400"><PlusIcon className="w-3.5 h-3.5" /></button>
                </div>
                
                <span className="text-[10px] font-mono text-zinc-500 w-8 text-center">{sequencerSpeed}x</span>

                <button 
                  title="Next Segment"
                  onClick={handleNextSegment}
                  disabled={(currentSegmentIndex + 1) * segmentDuration >= (audioState.duration || Infinity)}
                  className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-lg text-xs font-medium text-zinc-300 flex items-center gap-1"
                >
                    Next <ChevronRightIcon className="w-4 h-4" />
                </button>
             </div>
          </div>

          {/* Consolidated Control & Analysis Panel */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 shadow-sm flex flex-col gap-4 relative overflow-hidden">
                {/* AI Badge */}
                <div className="absolute top-0 right-0 p-2 opacity-10 pointer-events-none">
                    <div className="w-20 h-20 bg-indigo-500 rounded-full blur-2xl"></div>
                </div>

                <div className="flex items-center justify-between relative z-10">
                    <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                        <ActivityIcon className="w-4 h-4 text-indigo-400" />
                        Control & Analysis
                    </h3>
                    {/* Play Rhythm Button */}
                    <button
                        onClick={() => setIsRhythmPlaying(!isRhythmPlaying)}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${isRhythmPlaying ? 'bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.5)] animate-pulse' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'}`}
                        title={isRhythmPlaying ? "Stop Rhythm" : "Start Rhythm"}
                    >
                        {isRhythmPlaying ? <PauseIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5 ml-0.5" />}
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-4 relative z-10">
                    {/* Duration */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">Segment Duration</label>
                        <div className="relative">
                            <select 
                                value={segmentDuration} 
                                onChange={(e) => { setSegmentDuration(Number(e.target.value) as any); resetSession(undefined); }}
                                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 appearance-none"
                            >
                                <option value={10}>10s (High Precision)</option>
                                <option value={20}>20s (Standard)</option>
                                <option value={30}>30s (Overview)</option>
                            </select>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none text-[10px]">▼</div>
                        </div>
                    </div>

                    {/* BPM */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">Tempo (BPM)</label>
                        <input
                            type="number" 
                            value={bpm} 
                            onChange={(e) => setBpm(Number(e.target.value))}
                            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                            min="40" max="240"
                        />
                    </div>

                    {/* Style */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">Rhythm Style</label>
                        <div className="relative">
                            <select
                                value={labelSettings.selectedStyle}
                                onChange={(e) => setLabelSettings(prev => ({ ...prev, selectedStyle: e.target.value }))}
                                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 appearance-none"
                            >
                                {STYLES.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none text-[10px]">▼</div>
                        </div>
                    </div>

                    {/* Instrument */}
                    <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wide">Instrument Voice</label>
                        <div className="relative">
                            <select
                                value={labelSettings.selectedVoice}
                                onChange={(e) => setLabelSettings(prev => ({ ...prev, selectedVoice: e.target.value }))}
                                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 appearance-none"
                            >
                                {VOICES.map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                            </select>
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none text-[10px]">▼</div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-2 pt-3 border-t border-zinc-800/50 relative z-10">
                    <button onClick={handleSuggestSettings} className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors">
                        <LightBulbIcon className="w-3.5 h-3.5 text-yellow-500" /> 
                        Suggest Settings
                    </button>
                    <button onClick={handleRegenerate} className="flex-1 py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 border border-indigo-500/20 transition-colors">
                        <RefreshIcon className="w-3.5 h-3.5" /> 
                        Re-Analyze
                    </button>
                </div>
          </div>

        </section>

        <section className="lg:col-span-8 flex flex-col gap-0">
          <div className="bg-white rounded-t-xl shadow-xl overflow-hidden min-h-[320px] border border-zinc-800 relative group z-10">
            {(isProcessing) && (
                <div className="absolute inset-0 bg-zinc-900/90 z-20 flex flex-col items-center justify-center transition-opacity">
                    <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-indigo-400 font-medium animate-pulse">Deep Analysis: Detecting Key & Rhythm...</p>
                </div>
            )}
            {!audioState.sourceUrl && !ytVideoId && !isProcessing && (
                <div className="absolute inset-0 bg-zinc-100 flex flex-col items-center justify-center z-10">
                   <div className="w-16 h-16 bg-zinc-200 rounded-full flex items-center justify-center mb-4"><MusicIcon className="w-8 h-8 text-zinc-400" /></div>
                   <h3 className="text-zinc-900 font-semibold text-lg">Ready to Create</h3>
                </div>
            )}

            <SheetMusic 
                scrollRef={sheetMusicScrollRef}
                onScroll={handleSheetMusicScroll}
                notes={notes} currentTime={audioState.currentTime} totalDuration={audioState.duration}
                onNoteClick={handleNoteClick} selectedNoteId={selectedNoteId} labelSettings={labelSettings}
            />
          </div>
          
          <div className="rounded-b-xl overflow-hidden border-x border-b border-zinc-800 -mt-[1px]">
            <ConfidenceHeatmap 
                scrollRef={heatmapScrollRef}
                onScroll={handleHeatmapScroll}
                notes={notes} currentTime={audioState.currentTime} totalDuration={audioState.duration} 
            />
          </div>
          
          {/* Player / Visualization Area */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden h-48 shadow-lg relative mt-6">
             {audioState.sourceType === 'youtube' && ytVideoId ? (
                 <>
                    {isRestricted && (
                        <div className="absolute inset-0 bg-black/80 z-20 flex flex-col items-center justify-center p-4 text-center">
                            <span className="text-red-400 font-bold mb-2">Playback Restricted</span>
                            <p className="text-zinc-400 text-xs">Owner disabled embedded playback.<br/>Notes generated successfully.</p>
                        </div>
                    )}
                    <YouTubePlayer 
                        videoId={ytVideoId}
                        isPlaying={audioState.isPlaying}
                        onReady={onYoutubePlayerReady}
                        onStateChange={(isPlaying) => setAudioState(p => ({ ...p, isPlaying }))}
                        onTimeUpdate={handleYoutubeTimeUpdate}
                        seekTo={seekTarget}
                        onError={handleYoutubeError}
                    />
                 </>
             ) : (
                <>
                    <Equalizer isPlaying={audioState.isPlaying} />
                </>
             )}
          </div>

        </section>

      </main>
    </div>
  );
};

export default App;
