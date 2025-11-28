
import { RhythmPattern } from '../components/constants';
import { NoteEvent } from '../types';
import { Essentia, EssentiaWASM } from './essentia-shim';

// Krumhansl-Schmuckler Key-Finding Profiles
const PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export class AudioEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private connectedElements = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private activeOscillators = new Set<OscillatorNode | AudioBufferSourceNode>();
  private essentia: Essentia | null = null;
  private essentiaInitalized = false;

  // Rhythm Engine
  private nextNoteTime: number = 0;
  private currentBeatIndex: number = 0;
  private rhythmTimerID: number | null = null;
  private isRhythmPlaying: boolean = false;
  private currentPattern: RhythmPattern | null = null;
  private currentBpm: number = 120;

  constructor() {
    if (typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      }
    }
  }

  async init() {
    if (this.essentiaInitalized) {
      return;
    }
    try {
        await EssentiaWASM().then((EssentiaWasmModule) => {
            if (!EssentiaWasmModule) {
                console.error("EssentiaWASM failed to load module");
                return;
            }
            // Ensure we are instantiating the class correctly
            try {
                this.essentia = new Essentia(EssentiaWasmModule);
                this.essentiaInitalized = true;
                if (this.essentia) {
                    console.log('[Essentia] Loaded version ' + this.essentia.version);
                }
            } catch (instantiationError) {
                console.error("Error creating Essentia instance:", instantiationError);
                console.log("Module keys:", Object.keys(EssentiaWasmModule));
                // Optionally try to find EssentiaJS if buried
            }
        });
    } catch (error) {
        console.error("Failed to initialize Essentia:", error);
    }
  }

  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        console.error("Failed to resume AudioContext", e);
      }
    }
  }

  get context() {
    return this.audioContext;
  }

  get sampleRate() {
    return this.audioContext?.sampleRate || 44100;
  }

  connectElement(element: HTMLMediaElement) {
    if (!this.audioContext || !this.analyser) return;
    
    if (this.connectedElements.has(element)) {
      const existingSource = this.connectedElements.get(element);
      if (existingSource) {
        try {
          existingSource.connect(this.analyser);
          this.analyser.connect(this.audioContext.destination);
        } catch (e) {}
      }
      return;
    }

    try {
      const source = this.audioContext.createMediaElementSource(element);
      source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
      this.connectedElements.set(element, source);
      this.source = source;
    } catch (e) {
      console.warn("Audio source connection failed", e);
    }
  }

  getFrequencyData(_?: any): Uint8Array {
    if (!this.analyser || !this.dataArray) return new Uint8Array(64);
    this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  playTone(midiPitch: number, duration: number = 0.5, velocity: number = 100, voice: string = 'piano') {
    if (!this.audioContext || !isFinite(midiPitch) || !isFinite(duration) || duration <= 0) return;
    this.resume();

    const now = this.audioContext.currentTime;
    const frequency = 440 * Math.pow(2, (midiPitch - 69) / 12);
    
    const masterGain = this.audioContext.createGain();
    masterGain.connect(this.audioContext.destination);
    
    const gain = velocity / 127;
    const releaseTime = 0.1;
    const sustainTime = duration; 
    
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(gain, now + 0.015);
    masterGain.gain.exponentialRampToValueAtTime(velocity * 0.1, now + sustainTime);
    masterGain.gain.linearRampToValueAtTime(0, now + sustainTime + releaseTime);

    const osc1 = this.audioContext.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(frequency, now);
    osc1.detune.setValueAtTime(Math.random() * 4 - 2, now); 
    osc1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + sustainTime + releaseTime);
    this.activeOscillators.add(osc1);
    osc1.onended = () => this.activeOscillators.delete(osc1);

    const osc2 = this.audioContext.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(frequency * 2, now);
    const osc2Gain = this.audioContext.createGain();
    osc2Gain.gain.value = 0.3;
    osc2.connect(osc2Gain).connect(masterGain);
    osc2.start(now);
    osc2.stop(now + sustainTime + releaseTime);
    this.activeOscillators.add(osc2);
    osc2.onended = () => this.activeOscillators.delete(osc2);

    const bufferSize = this.audioContext.sampleRate * 0.05;
    const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = this.audioContext.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 1000;
    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
    
    noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
    noise.start(now);
    this.activeOscillators.add(noise);
  }

  playDrumSound(sound: string, velocity: number) {
      if (!this.audioContext) return;
      const t = this.audioContext.currentTime;
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      
      gain.gain.setValueAtTime(velocity, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
      
      if (sound === 'kick') {
          osc.frequency.setValueAtTime(150, t);
          osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
      } else {
          osc.type = 'square';
          osc.frequency.setValueAtTime(200, t);
          gain.gain.value = velocity * 0.3;
      }
      
      osc.start(t);
      osc.stop(t + 0.1);
  }

  private scheduleNote() {
      if (!this.currentPattern || !this.audioContext) return;
      const secondsPerBeat = 60.0 / this.currentBpm;
      
      while (this.nextNoteTime < this.audioContext.currentTime + 0.1) {
          const currentBeatInBar = this.currentBeatIndex % this.currentPattern.length;
          this.currentPattern.steps.forEach(step => {
              if (Math.abs(step.beat - currentBeatInBar) < 0.01) {
                   this.playDrumSound(step.sound, step.velocity);
              }
          });
          this.nextNoteTime += (secondsPerBeat * 0.5);
          this.currentBeatIndex += 0.5;
      }
      if (this.isRhythmPlaying) {
          this.rhythmTimerID = window.setTimeout(() => this.scheduleNote(), 25);
      }
  }

  startRhythm(pattern: RhythmPattern, bpm: number) {
      if (this.isRhythmPlaying) return;
      this.resume();
      this.currentPattern = pattern;
      this.currentBpm = bpm;
      this.currentBeatIndex = 0;
      this.nextNoteTime = this.audioContext?.currentTime || 0;
      this.isRhythmPlaying = true;
      this.scheduleNote();
  }

  stopRhythm() {
      this.isRhythmPlaying = false;
      if (this.rhythmTimerID) clearTimeout(this.rhythmTimerID);
  }

  stopAllTones() {
      this.stopRhythm();
      this.activeOscillators.forEach(osc => {
          try { osc.stop(); } catch (e) {}
      });
      this.activeOscillators.clear();
  }

  async loadAudioFile(file: File): Promise<AudioBuffer> {
      if (!this.audioContext) throw new Error("Audio Context not initialized");
      const arrayBuffer = await file.arrayBuffer();
      return await this.audioContext.decodeAudioData(arrayBuffer);
  }

  // Public method for UI to call for regeneration
  async analyzeSegment(audioBuffer: AudioBuffer, startTime: number, endTime: number): Promise<NoteEvent[]> {
      if (!this.essentia) throw new Error("Essentia not initialized");
      return await this.processSegment(audioBuffer, startTime, endTime);
  }

  async analyzeAudio(file: File): Promise<NoteEvent[]> {
    if (!this.audioContext || !this.essentia) {
      // Re-try init just in case
      await this.init();
      if (!this.essentia) {
         throw new Error("AudioContext or Essentia not initialized");
      }
    }

    const audioBuffer = await this.loadAudioFile(file);
    const sr = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const duration = audioBuffer.duration;
    console.log(`[Transcription] Input: ${file.name}, SR: ${sr}, Channels: ${channels}, Duration: ${duration.toFixed(2)}s`);

    const MAX_ALLOWED_DURATION = 600;
    const segments = [];
    if (duration > MAX_ALLOWED_DURATION) {
        console.log(`[Transcription] Audio is longer than ${MAX_ALLOWED_DURATION}s, segmenting...`);
        let currentTime = 0;
        while (currentTime < duration) {
            segments.push({ start: currentTime, end: Math.min(currentTime + 30, duration) });
            currentTime += 25; // 30s segment with 5s overlap
        }
    } else {
        segments.push({ start: 0, end: duration });
    }

    let allNotes: NoteEvent[] = [];
    for (const segment of segments) {
        const segmentNotes = await this.processSegment(audioBuffer, segment.start, segment.end);
        allNotes = allNotes.concat(segmentNotes);
    }

    return allNotes;
  }

  private async processSegment(audioBuffer: AudioBuffer, startTime: number, endTime: number): Promise<NoteEvent[]> {
    if (!this.essentia) throw new Error("Essentia not initialized");

    const sr = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);

    const startSample = Math.floor(startTime * sr);
    const endSample = Math.floor(endTime * sr);
    // Slice the raw data for this segment
    const segmentData = channelData.slice(startSample, endSample);

    // Convert to Essentia vector
    const audioVector = this.essentia.arrayToVector(segmentData);

    const processedVector = this.essentia.HighPass(audioVector, 40, sr).signal;

    // Tempo and beat tracking
    const beatResult = this.essentia.BeatTrackerMultiFeature(processedVector, sr);
    const beats = this.essentia.vectorToArray(beatResult.ticks);
    const bpm = beatResult.bpm;

    console.log(`[Transcription] Estimated BPM: ${bpm.toFixed(2)}`);

    // Multi-pitch estimation using MultiPitchMelodia
    const pitchResult = this.essentia.MultiPitchMelodia(processedVector, sr);
    const pitches = this.essentia.vectorToArray(pitchResult.pitch);
    const pitchConfidence = this.essentia.vectorToArray(pitchResult.pitchConfidence);

    // Analyze
    const notes = this.segmentNotesFromMultiPitch(pitches, pitchConfidence, 512 / sr);
    const voices = this.assignVoices(notes);
    const quantizedNotes = this.quantizeNotes(voices, beats, bpm);

    // Pass the raw segment data array instead of the vector wrapper to avoid .get() issues
    const expressiveNotes = this.extractExpressiveParameters(quantizedNotes, segmentData, sr);

    const finalNotes = this.applyMusicologicalCorrections(expressiveNotes, processedVector);

    // Clean up WASM memory
    // (Ideally we should delete vectors but Essentia JS might handle some,
    // explicit delete is safer if we knew the C++ pointer, but here we just rely on GC/Essentia handling)
    // this.essentia.delete(audioVector); // Not all Essentia JS bindings support explicit delete easily without leaking

    // Offset times by segment start time
    return finalNotes.map(n => ({
        ...n,
        start_s: n.start_s + startTime,
        end_s: n.end_s + startTime
    }));
  }

  private segmentNotesFromMultiPitch(pitches: number[][], pitchConfidence: number[][], frameDuration: number): NoteEvent[] {
    const notes: NoteEvent[] = [];
    const activeNotes: { [key: number]: any } = {};
    const minNoteDuration = 0.05;

    for (let i = 0; i < pitches.length; i++) {
        const time = i * frameDuration;
        const framePitches = new Set(pitches[i].filter(p => p > 0).map((p, j) => ({
            pitch: 69 + 12 * Math.log2(p / 440),
            confidence: pitchConfidence[i][j]
        })));

        // End notes that are no longer active
        for (const pitch in activeNotes) {
            if (![...framePitches].some(p => p.pitch === parseFloat(pitch))) {
                if (activeNotes[pitch].duration >= minNoteDuration) {
                    notes.push(activeNotes[pitch]);
                }
                delete activeNotes[pitch];
            }
        }

        // Start new notes or extend existing ones
        for (const pitch of framePitches) {
            if (activeNotes[pitch.pitch]) {
                activeNotes[pitch.pitch].duration += frameDuration;
            } else {
                activeNotes[pitch.pitch] = {
                    id: `gen_${Date.now()}_${notes.length}`,
                    start_s: time,
                    duration_s: frameDuration,
                    midi_note: pitch.pitch,
                    velocity: 0.8,
                    confidence: pitch.confidence
                };
            }
        }
    }

    // Add any remaining active notes
    for (const pitch in activeNotes) {
        if (activeNotes[pitch].duration >= minNoteDuration) {
            notes.push(activeNotes[pitch]);
        }
    }

    return notes;
  }

  private assignVoices(notes: NoteEvent[]): NoteEvent[] {
    const voices: NoteEvent[][] = [];
    const maxVoices = 4;
    const pitchTolerance = 2; // semitones

    for (const note of notes) {
        let assigned = false;
        for (let i = 0; i < voices.length; i++) {
            const lastNote = voices[i][voices[i].length - 1];
            if (lastNote && Math.abs(lastNote.midi_note - note.midi_note) <= pitchTolerance) {
                voices[i].push(note);
                assigned = true;
                break;
            }
        }
        if (!assigned && voices.length < maxVoices) {
            voices.push([note]);
        }
    }

    let result: NoteEvent[] = [];
    for (let i = 0; i < voices.length; i++) {
        for (const note of voices[i]) {
            result.push({ ...note, voice_id: i });
        }
    }
    return result;
  }

  private quantizeNotes(notes: NoteEvent[], beats: number[], bpm: number): NoteEvent[] {
    const beatDuration = 60 / bpm;
    const subdivisions = [1, 0.5, 0.25, 0.125]; // Whole, half, quarter, eighth

    return notes.map(note => {
        const nearestBeat = beats.reduce((prev, curr) => {
            return (Math.abs(curr - note.start_s) < Math.abs(prev - note.start_s) ? curr : prev);
        });

        let quantizedStart = nearestBeat;
        let minDiff = Infinity;

        for (const sub of subdivisions) {
            const subBeatDuration = beatDuration * sub;
            const numSubBeats = Math.round((note.start_s - nearestBeat) / subBeatDuration);
            const quantizedTime = nearestBeat + numSubBeats * subBeatDuration;
            const diff = Math.abs(note.start_s - quantizedTime);
            if (diff < minDiff) {
                minDiff = diff;
                quantizedStart = quantizedTime;
            }
        }

        const durationInBeats = note.duration_s / beatDuration;
        const quantizedDurationInBeats = subdivisions.reduce((prev, curr) => {
            return (Math.abs(curr - durationInBeats) < Math.abs(prev - durationInBeats) ? curr : prev);
        });
        const quantizedDuration = quantizedDurationInBeats * beatDuration;

        return {
            ...note,
            start_s: quantizedStart,
            duration_s: quantizedDuration,
            end_s: quantizedStart + quantizedDuration
        };
    });
  }

  // Modified to accept Float32Array instead of Essentia Vector
  private extractExpressiveParameters(notes: NoteEvent[], segmentData: Float32Array, sampleRate: number): NoteEvent[] {
    if (!this.essentia) return notes;

    return notes.map(note => {
      const startSample = Math.floor(note.start_s * sampleRate);
      const endSample = Math.floor(note.end_s * sampleRate);

      // Safety check for bounds
      if (startSample >= segmentData.length || endSample > segmentData.length || startSample >= endSample) {
          return { ...note, velocity: 80 };
      }

      const rawSlice = segmentData.slice(startSample, endSample);
      const noteAudioVector = this.essentia.arrayToVector(rawSlice);
      const rms = this.essentia.RMS(noteAudioVector).rms;

      // Ideally delete noteAudioVector here, but depends on API

      // Simple mapping from RMS to MIDI velocity
      const velocity = Math.min(127, Math.max(0, Math.round(rms * 5 * 127)));

      return {
        ...note,
        velocity: velocity,
      };
    });
  }

  private applyMusicologicalCorrections(notes: NoteEvent[], audioVector: any): NoteEvent[] {
    if (!this.essentia) return notes;

    // Key detection
    const keyResult = this.essentia.Key(audioVector, true, 4096, 512, 'cosine', 'krumhansl', 1024, 44100);
    const key = keyResult.key;
    const scale = keyResult.scale;

    console.log(`[Transcription] Estimated Key: ${key} ${scale}`);

    // Placeholder for more advanced corrections
    return notes.map(note => {
      const noteName = this.midiToNoteName(note.midi_note, key);
      return {
        ...note,
        note_name: noteName,
        quantized_value: 'quarter', // Placeholder
        cent_offset: 0, // Placeholder
        vibrato: null, // Placeholder
        instrument: 'piano', // Placeholder
      };
    });
  }

  private midiToNoteName(midi: number, key: string): string {
    const noteNamesSharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const noteNamesFlat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    const octave = Math.floor(midi / 12) - 1;
    const noteIndex = Math.round(midi) % 12;

    // Simple logic to prefer sharps or flats based on key
    if (['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb'].includes(key)) {
        return noteNamesFlat[noteIndex] + octave;
    }
    return noteNamesSharp[noteIndex] + octave;
  }
}

export const audioEngine = new AudioEngine();
