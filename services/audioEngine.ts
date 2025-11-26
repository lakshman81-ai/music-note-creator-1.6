
import { RhythmPattern } from '../components/constants';
import { NoteEvent } from '../types';

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

  playTone(midiPitch: number, duration: number = 0.5, voice: string = 'piano') {
    if (!this.audioContext || !isFinite(midiPitch) || !isFinite(duration) || duration <= 0) return;
    this.resume();

    const now = this.audioContext.currentTime;
    const frequency = 440 * Math.pow(2, (midiPitch - 69) / 12);
    
    // --- Professional Piano Synthesis ---
    // Layer 1: Fundamental (Triangle/Sine mix for body)
    // Layer 2: Harmonics (Sawtooth low pass for richness)
    // Layer 3: Hammer Attack (Noise burst)

    const masterGain = this.audioContext.createGain();
    masterGain.connect(this.audioContext.destination);
    
    // Dynamic velocity simulation based on duration/pitch (shorter/higher = harder hit usually)
    const velocity = 0.6; 
    
    // Envelope: Fast Attack, Exponential Decay, Sustain level, Release
    // We simulate a "one-shot" piano note where sustain is the decay tail
    const releaseTime = 0.1;
    const sustainTime = duration; 
    
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(velocity, now + 0.015); // Attack
    masterGain.gain.exponentialRampToValueAtTime(velocity * 0.1, now + sustainTime); // Decay/Sustain
    masterGain.gain.linearRampToValueAtTime(0, now + sustainTime + releaseTime); // Release

    // 1. Body Oscillator (Triangle - Mellow)
    const osc1 = this.audioContext.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(frequency, now);
    // Detune slightly for chorus effect
    osc1.detune.setValueAtTime(Math.random() * 4 - 2, now); 
    osc1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + sustainTime + releaseTime);
    this.activeOscillators.add(osc1);
    osc1.onended = () => this.activeOscillators.delete(osc1);

    // 2. Harmonic Oscillator (Sine - 1 Octave up, lower volume)
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

    // 3. Hammer Noise (Short burst)
    const bufferSize = this.audioContext.sampleRate * 0.05; // 50ms
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
    // Short blip envelope
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.04);
    
    noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
    noise.start(now);
    this.activeOscillators.add(noise);
    // noise stops automatically after buffer
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

  /**
   * Multi-Pass Deep Analysis Engine
   */
  analyzeAudioSegment(audioBuffer: AudioBuffer, startTime: number, duration: number): NoteEvent[] {
      const sampleRate = audioBuffer.sampleRate;
      const startSample = Math.floor(startTime * sampleRate);
      const endSample = Math.floor((startTime + duration) * sampleRate);
      const channelData = audioBuffer.getChannelData(0);
      const segmentData = channelData.slice(Math.max(0, startSample), Math.min(channelData.length, endSample));
      
      const frames: { time: number, frequency: number, confidence: number, volume: number }[] = [];
      const windowSize = 2048;
      const hopSize = 441; // ~10ms

      // PASS 1: Adaptive Signal Processing
      let rmsSum = 0;
      for (let i = 0; i < segmentData.length; i += 100) {
          const val = segmentData[i];
          rmsSum += val * val;
      }
      const avgRMS = Math.sqrt(rmsSum / (segmentData.length / 100));
      const adaptiveThreshold = Math.max(0.005, avgRMS * 0.2); // Relaxed threshold, let YIN decide

      // PASS 2: Frame Extraction (YIN Algorithm)
      for (let i = 0; i < segmentData.length - windowSize; i += hopSize) {
          const chunk = segmentData.slice(i, i + windowSize);
          
          let sumSq = 0;
          for (let s = 0; s < chunk.length; s++) sumSq += chunk[s] * chunk[s];
          const frameRMS = Math.sqrt(sumSq / chunk.length);

          if (frameRMS > adaptiveThreshold) {
              const result = this.yinPitchDetection(chunk, sampleRate);
              if (result.frequency > 0 && result.probability > 0.3) { // Higher confidence floor
                  frames.push({
                      time: startTime + (i / sampleRate),
                      frequency: result.frequency,
                      confidence: result.probability,
                      volume: frameRMS
                  });
              } else {
                  frames.push({ time: startTime + (i / sampleRate), frequency: 0, confidence: 0, volume: 0 });
              }
          } else {
              frames.push({ time: startTime + (i / sampleRate), frequency: 0, confidence: 0, volume: 0 });
          }
      }

      // PASS 3: Key Estimation
      const detectedKey = this.detectKey(frames);

      // PASS 4: Smoothing & Segmentation
      const smoothedFrames = this.smoothFrames(frames);
      let notes = this.segmentNotes(smoothedFrames, hopSize / sampleRate);

      // PASS 5: Harmonic Quantization
      notes = this.harmonicQuantization(notes, detectedKey);

      // PASS 6: Rhythmic Cleanup & Grid Snapping (New!)
      notes = this.cleanupAndQuantize(notes);

      return notes.map((n, i) => ({ ...n, id: `note_${Math.floor(startTime)}_${i}` }));
  }

  private cleanupAndQuantize(notes: NoteEvent[]): NoteEvent[] {
      if (notes.length === 0) return [];

      // 1. Remove very short "ghost" notes (< 100ms)
      let cleanNotes = notes.filter(n => n.duration > 0.1);

      // 2. Rhythmic Quantization (Snap to 1/16th grid approx 125ms)
      const GRID_SIZE = 0.125; 
      cleanNotes = cleanNotes.map(n => {
          // Snap start time
          const snappedStart = Math.round(n.start_time / GRID_SIZE) * GRID_SIZE;
          // Snap duration (minimum 1 grid unit)
          let snappedDuration = Math.round(n.duration / GRID_SIZE) * GRID_SIZE;
          if (snappedDuration < GRID_SIZE) snappedDuration = GRID_SIZE;
          
          return {
              ...n,
              start_time: snappedStart,
              duration: snappedDuration
          };
      });

      // 3. Legato Merging (Bridge small gaps)
      const merged: NoteEvent[] = [];
      if (cleanNotes.length > 0) merged.push(cleanNotes[0]);

      for (let i = 1; i < cleanNotes.length; i++) {
          const prev = merged[merged.length - 1];
          const curr = cleanNotes[i];
          
          // Gap between prev end and curr start
          const gap = curr.start_time - (prev.start_time + prev.duration);
          
          // If gap is tiny (< 0.15s) and pitch is identical, merge them
          if (gap < 0.15 && Math.abs(prev.midi_pitch - curr.midi_pitch) < 0.1) {
              prev.duration = (curr.start_time + curr.duration) - prev.start_time;
          } 
          // If notes overlap (due to quantization) and pitch is same, merge
          else if (curr.start_time < prev.start_time + prev.duration && Math.abs(prev.midi_pitch - curr.midi_pitch) < 0.1) {
               prev.duration = Math.max(prev.duration, (curr.start_time + curr.duration) - prev.start_time);
          }
          else {
              merged.push(curr);
          }
      }

      return merged;
  }

  private detectKey(frames: any[]): { root: number, scale: 'major'|'minor', confidence: number } {
      const chroma = new Array(12).fill(0);
      let totalWeight = 0;

      frames.forEach(f => {
          if (f.frequency > 0 && f.confidence > 0.3) {
              const midi = 69 + 12 * Math.log2(f.frequency / 440);
              const pitchClass = Math.round(midi) % 12;
              chroma[pitchClass] += f.confidence;
              totalWeight += f.confidence;
          }
      });

      if (totalWeight === 0) return { root: 0, scale: 'major', confidence: 0 };
      const normalizedChroma = chroma.map(v => v / totalWeight);

      let maxCorr = -Infinity;
      let bestRoot = 0;
      let bestScale: 'major' | 'minor' = 'major';

      for (let root = 0; root < 12; root++) {
          let corr = 0;
          for (let i = 0; i < 12; i++) {
              corr += normalizedChroma[(root + i) % 12] * PROFILE_MAJOR[i];
          }
          if (corr > maxCorr) { maxCorr = corr; bestRoot = root; bestScale = 'major'; }
      }

      for (let root = 0; root < 12; root++) {
          let corr = 0;
          for (let i = 0; i < 12; i++) {
              corr += normalizedChroma[(root + i) % 12] * PROFILE_MINOR[i];
          }
          if (corr > maxCorr) { maxCorr = corr; bestRoot = root; bestScale = 'minor'; }
      }

      return { root: bestRoot, scale: bestScale, confidence: maxCorr };
  }

  private harmonicQuantization(notes: NoteEvent[], key: { root: number, scale: 'major'|'minor' }): NoteEvent[] {
      const majorIntervals = [0, 2, 4, 5, 7, 9, 11];
      const minorIntervals = [0, 2, 3, 5, 7, 8, 10];
      const intervals = key.scale === 'major' ? majorIntervals : minorIntervals;

      return notes.map(note => {
          const rawMidi = note.midi_pitch;
          const rounded = Math.round(rawMidi);
          const pitchClass = (rounded - key.root + 12) % 12;
          const isInScale = intervals.includes(pitchClass);

          if (isInScale) {
              return { ...note, midi_pitch: rounded };
          } else {
              let bestCandidate = rounded;
              let minDist = 100;
              for (let offset = -1; offset <= 1; offset++) {
                  const candidate = rounded + offset;
                  const candidatePC = (candidate - key.root + 12) % 12;
                  if (intervals.includes(candidatePC)) {
                      const dist = Math.abs(rawMidi - candidate);
                      if (dist < minDist) {
                          minDist = dist;
                          bestCandidate = candidate;
                      }
                  }
              }
              if (minDist < 0.4) {
                  return { ...note, midi_pitch: bestCandidate };
              } else {
                  return { ...note, midi_pitch: rounded };
              }
          }
      });
  }

  private yinPitchDetection(buffer: Float32Array, sampleRate: number): { frequency: number, probability: number } {
      const bufferSize = buffer.length;
      const W = Math.floor(bufferSize / 2); // Integration window
      const yinBuffer = new Float32Array(W);

      // 1. Difference Function (Optimized)
      // Using a simplified difference calculation for speed, although O(N^2) is intrinsic to strict YIN
      for (let tau = 0; tau < W; tau++) {
          let sum = 0;
          for (let j = 0; j < W; j++) {
              const delta = buffer[j] - buffer[j + tau];
              sum += delta * delta;
          }
          yinBuffer[tau] = sum;
      }

      // 2. Cumulative Mean Normalized Difference Function (CMNDF)
      yinBuffer[0] = 1;
      let runningSum = 0;
      for (let tau = 1; tau < W; tau++) {
          runningSum += yinBuffer[tau];
          if (runningSum === 0) {
              yinBuffer[tau] = 1;
          } else {
              // The formula is d'(t) = d(t) / ( (1/t) * sum(d(j)) )
              // which is d(t) * t / sum(d(j))
              yinBuffer[tau] *= tau / runningSum;
          }
      }

      // 3. Absolute Threshold Search
      // We constrain the search to musical frequencies to avoid noise
      const minFreq = 27.5; // A0
      const maxFreq = 4186; // C8
      // tau = fs / freq
      // minTau corresponds to maxFreq (Small period)
      // maxTau corresponds to minFreq (Large period)
      const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
      const maxTau = Math.min(W - 2, Math.floor(sampleRate / minFreq));

      const threshold = 0.15;
      let tauEstimate = -1;

      // Search for first dip below threshold
      // This prioritizes higher frequencies (smaller tau), consistent with YIN
      for (let tau = minTau; tau < maxTau; tau++) {
          if (yinBuffer[tau] < threshold) {
              // Found a point below threshold. Find the local minimum.
              while (tau + 1 < maxTau && yinBuffer[tau + 1] < yinBuffer[tau]) {
                  tau++;
              }
              tauEstimate = tau;
              break;
          }
      }

      // 4. Fallback: Global Minimum
      // If no candidate met the threshold, find the global minimum within range.
      // This helps with quiet or noisy signals where the dip isn't perfect but is still the best candidate.
      if (tauEstimate === -1) {
          let globalMinVal = 100;
          let globalMinTau = -1;
          
          for (let tau = minTau; tau < maxTau; tau++) {
              if (yinBuffer[tau] < globalMinVal) {
                  globalMinVal = yinBuffer[tau];
                  globalMinTau = tau;
              }
          }
          
          // Only accept if it's a somewhat periodic signal (e.g. prob > 0.4 => val < 0.6)
          // If the best dip is 0.8, it's likely noise.
          if (globalMinVal < 0.6) {
              tauEstimate = globalMinTau;
          }
      }

      if (tauEstimate === -1) {
          return { frequency: -1, probability: 0 };
      }

      // 5. Parabolic Interpolation
      // Refines the integer tau estimate to fractional values for better pitch accuracy
      let betterTau = tauEstimate;
      if (tauEstimate > 0 && tauEstimate < W - 1) {
          const s0 = yinBuffer[tauEstimate - 1];
          const s1 = yinBuffer[tauEstimate];
          const s2 = yinBuffer[tauEstimate + 1];
          const denominator = 2 * (2 * s1 - s2 - s0);
          if (Math.abs(denominator) > 1e-6) { // Avoid division by zero
              const adjustment = (s2 - s0) / denominator;
              betterTau += adjustment;
          }
      }

      const probability = 1 - Math.min(1, yinBuffer[tauEstimate]);
      return { frequency: sampleRate / betterTau, probability };
  }

  private smoothFrames(frames: any[]) {
      const medianWindow = 7;
      const result = frames.map(f => ({ ...f }));
      
      for (let i = 0; i < frames.length; i++) {
          const start = Math.max(0, i - Math.floor(medianWindow / 2));
          const end = Math.min(frames.length, i + Math.floor(medianWindow / 2) + 1);
          const window = frames.slice(start, end).filter(f => f.frequency > 0).map(f => f.frequency);
          
          if (window.length > Math.floor(medianWindow / 2)) {
              window.sort((a, b) => a - b);
              result[i].frequency = window[Math.floor(window.length / 2)];
          } else {
              if (frames[i].frequency > 0 && window.length < 2) result[i].frequency = 0;
          }
      }
      return result;
  }

  private segmentNotes(frames: any[], frameDuration: number): NoteEvent[] {
      const notes: NoteEvent[] = [];
      let currentNote: any = null;
      const minNoteDuration = 0.08;

      for (const frame of frames) {
          if (frame.frequency <= 0) {
              if (currentNote) {
                  if (currentNote.duration >= minNoteDuration) notes.push(currentNote);
                  currentNote = null;
              }
              continue;
          }

          const midiPitch = 69 + 12 * Math.log2(frame.frequency / 440);
          
          if (currentNote) {
              if (Math.abs(currentNote.midi_pitch - midiPitch) < 0.8) {
                  const totalDuration = currentNote.duration + frameDuration;
                  currentNote.midi_pitch = (currentNote.midi_pitch * currentNote.duration + midiPitch * frameDuration) / totalDuration;
                  currentNote.duration = totalDuration;
                  currentNote.confidence = Math.max(currentNote.confidence, frame.confidence);
              } else {
                  if (currentNote.duration >= minNoteDuration) notes.push(currentNote);
                  currentNote = {
                      id: `gen_${Date.now()}_${notes.length}`,
                      start_time: frame.time,
                      duration: frameDuration,
                      midi_pitch: midiPitch,
                      velocity: Math.min(1, frame.volume * 5),
                      confidence: frame.confidence
                  };
              }
          } else {
              currentNote = {
                  id: `gen_${Date.now()}_${notes.length}`,
                  start_time: frame.time,
                  duration: frameDuration,
                  midi_pitch: midiPitch,
                  velocity: Math.min(1, frame.volume * 5),
                  confidence: frame.confidence
              };
          }
      }
      
      if (currentNote && currentNote.duration >= minNoteDuration) notes.push(currentNote);
      return notes; // Merging is now handled by cleanupAndQuantize
  }
}

export const audioEngine = new AudioEngine();
