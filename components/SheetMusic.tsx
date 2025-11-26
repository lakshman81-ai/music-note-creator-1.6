
import React, { useEffect } from 'react';
import { NoteEvent } from '../types';
import { LabelSettings } from '../types';
import { formatPitch } from '../utils/pitchUtils';

interface SheetMusicProps {
  notes: NoteEvent[];
  currentTime: number;
  totalDuration: number;
  onNoteClick: (noteId: string) => void;
  selectedNoteId: string | null;
  labelSettings: LabelSettings;
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void;
}

// Layout Constants
const STAFF_LINE_H = 10; // 10px spacing between lines
const NOTE_RADIUS_X = 6;
const NOTE_RADIUS_Y = 5;
export const PIXELS_PER_SECOND = 80; // Exported for syncing with Heatmap
const PADDING_LEFT = 60; // Space for Clefs

// Vertical Layout
const TREBLE_TOP_Y = 60;
const TREBLE_BOTTOM_Y = 100; // 5 lines: 60, 70, 80, 90, 100
const BASS_TOP_Y = 160;
const BASS_BOTTOM_Y = 200; // 5 lines: 160, 170, 180, 190, 200

// Pitch Constants
// Diatonic Steps map (C=0, D=1, ... B=6)
const MIDI_TO_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; 
const IS_ACCIDENTAL = [false, true, false, true, false, false, true, false, true, false, true, false];

const getGlobalStep = (midiPitch: number) => {
    const octave = Math.floor(midiPitch / 12) - 1;
    const semitone = midiPitch % 12;
    return (octave * 7) + MIDI_TO_STEP[semitone];
};

const SheetMusic: React.FC<SheetMusicProps> = ({ 
    notes, currentTime, totalDuration, onNoteClick, selectedNoteId, labelSettings, scrollRef, onScroll 
}) => {
  
  // Sync scroll with playhead
  useEffect(() => {
    if (scrollRef && scrollRef.current) {
      const playheadX = PADDING_LEFT + (currentTime * PIXELS_PER_SECOND);
      const containerWidth = scrollRef.current.clientWidth;
      const targetScroll = playheadX - (containerWidth / 2);
      
      if (Math.abs(scrollRef.current.scrollLeft - targetScroll) > 50) { // Threshold to prevent jitter
         scrollRef.current.scrollTo({
             left: Math.max(0, targetScroll),
             behavior: 'smooth'
         });
      }
    }
  }, [currentTime, scrollRef]);

  const renderStaff = (topY: number, clefType: 'treble' | 'bass') => {
    const lines = [];
    for (let i = 0; i < 5; i++) {
      const y = topY + (i * STAFF_LINE_H);
      lines.push(
        <line key={`${clefType}-line-${i}`} x1={0} y1={y} x2="100%" y2={y} stroke="#52525b" strokeWidth="1" />
      );
    }
    return lines;
  };

  const renderRuler = (width: number) => {
      const ticks = [];
      const labels = [];
      const totalSeconds = Math.ceil(width / PIXELS_PER_SECOND);
      
      for (let s = 0; s <= totalSeconds; s++) {
          const x = PADDING_LEFT + (s * PIXELS_PER_SECOND);
          if (x > width) break;
          const isMajor = s % 4 === 0; // Every 4 seconds
          
          // Tick line
          ticks.push(
            <line 
                key={`tick-${s}`} 
                x1={x} 
                y1={TREBLE_TOP_Y - 10} 
                x2={x} 
                y2={BASS_BOTTOM_Y + 10} 
                stroke={isMajor ? "#d4d4d8" : "#27272a"} 
                strokeWidth={isMajor ? 1 : 0.5} 
                strokeDasharray={isMajor ? "" : "2 2"}
                opacity={0.5}
            />
          );

          // Time Label
          if (s % 1 === 0) {
              labels.push(
                  <text 
                    key={`label-${s}`} 
                    x={x + 2} 
                    y={TREBLE_TOP_Y - 15} 
                    fontSize="10" 
                    fill="#a1a1aa" 
                    fontFamily="monospace"
                  >
                      {s}s
                  </text>
              );
          }
      }
      return { ticks, labels };
  };

  // Helper to get render coordinates for a note
  const getNoteLayout = (midiPitch: number) => {
      const step = getGlobalStep(midiPitch);
      const isSharp = IS_ACCIDENTAL[midiPitch % 12];
      
      const isTreble = midiPitch >= 60;
      
      let y = 0;
      let staffCenterStep = 0; 
      let staffCenterY = 0;
      let stemDirection: 'up' | 'down' = 'up';
      
      if (isTreble) {
          staffCenterStep = 34; // B4
          staffCenterY = TREBLE_TOP_Y + (2 * STAFF_LINE_H);
          stemDirection = step >= 34 ? 'down' : 'up';
      } else {
          staffCenterStep = 22; // D3
          staffCenterY = BASS_TOP_Y + (2 * STAFF_LINE_H);
          stemDirection = step >= 22 ? 'down' : 'up';
      }

      y = staffCenterY - ((step - staffCenterStep) * (STAFF_LINE_H / 2));
      return { y, isTreble, stemDirection, isSharp, step };
  };

  const renderLedgerLines = (x: number, y: number, step: number, isTreble: boolean, strokeColor: string = 'black') => {
      const lines = [];
      if (isTreble) {
          if (step > 38) { // Above Treble
             for (let s = 40; s <= step; s += 2) {
                 const ly = TREBLE_TOP_Y - ((s - 38) * (STAFF_LINE_H / 2));
                 lines.push(<line key={`l-high-${s}`} x1={x-10} y1={ly} x2={x+10} y2={ly} stroke={strokeColor} strokeWidth="1" />);
             }
          }
          if (step < 30) { // Below Treble
             for (let s = 28; s >= step; s -= 2) {
                 const ly = TREBLE_BOTTOM_Y + ((30 - s) * (STAFF_LINE_H / 2));
                 lines.push(<line key={`l-low-${s}`} x1={x-10} y1={ly} x2={x+10} y2={ly} stroke={strokeColor} strokeWidth="1" />);
             }
          }
      } else {
          if (step > 26) { // Above Bass
             for (let s = 28; s <= step; s += 2) {
                 const ly = BASS_TOP_Y - ((s - 26) * (STAFF_LINE_H / 2));
                 lines.push(<line key={`l-bass-high-${s}`} x1={x-10} y1={ly} x2={x+10} y2={ly} stroke={strokeColor} strokeWidth="1" />);
             }
          }
          if (step < 18) { // Below Bass
             for (let s = 16; s >= step; s -= 2) {
                 const ly = BASS_BOTTOM_Y + ((18 - s) * (STAFF_LINE_H / 2));
                 lines.push(<line key={`l-bass-low-${s}`} x1={x-10} y1={ly} x2={x+10} y2={ly} stroke={strokeColor} strokeWidth="1" />);
             }
          }
      }
      return lines;
  };

  const minWidth = 1000;
  // Ensure we allocate enough width for the full duration plus some buffer
  const computedWidth = PADDING_LEFT + (Math.max(1, totalDuration) * PIXELS_PER_SECOND) + 200;
  const totalWidth = Math.max(minWidth, computedWidth);
  const ruler = renderRuler(totalWidth);

  return (
    <div 
      ref={scrollRef}
      onScroll={onScroll}
      className="w-full h-[320px] overflow-x-auto bg-white rounded-t-lg shadow-sm relative select-none"
    >
      <svg width={totalWidth} height={320} className="absolute top-0 left-0">
        
        {/* Render Ruler & Staves */}
        {ruler.ticks}
        {ruler.labels}

        {renderStaff(TREBLE_TOP_Y, 'treble')}
        {renderStaff(BASS_TOP_Y, 'bass')}
        

        {/* Start Line */}
        <line x1={PADDING_LEFT} y1={TREBLE_TOP_Y} x2={PADDING_LEFT} y2={BASS_BOTTOM_Y} stroke="black" strokeWidth="3" />
        {/* Brace */}
        <path d={`M ${PADDING_LEFT-15} ${TREBLE_TOP_Y} Q ${PADDING_LEFT-25} ${TREBLE_TOP_Y+50} ${PADDING_LEFT-15} ${BASS_BOTTOM_Y/2 + TREBLE_TOP_Y/2} Q ${PADDING_LEFT-5} ${BASS_BOTTOM_Y-50} ${PADDING_LEFT-15} ${BASS_BOTTOM_Y}`} fill="none" stroke="black" strokeWidth="2" />

        {/* Treble Clef */}
        <path 
            transform={`translate(10, ${TREBLE_TOP_Y - 10}) scale(0.9)`}
            d="M15.8,55.1c-4.4-2.8-5.3-7.5-3.5-12.7c1.3-3.6,5.3-7.2,8.9-6.3c3.1,0.8,4.3,3.8,3.2,7.3c-1,3.2-3.8,4.3-5.3,4.1 c-0.6-0.1-1.3-0.5-0.9-1.9c0.8-2.6,3.6-2.5,4.1-1.2c0.3,0.9-0.2,1.7-0.7,2c-1.3,0.9,0.7,2.8,2.8,1.2c2.4-1.8,2.7-6.2-0.8-8.8 c-3.8-2.8-9.9,1-12.1,5.5c-2.4,4.9-1.8,11.2,3.1,15.6c4,3.6,8.9,2.4,12.3-2.1c5-6.6,2.3-17.1-3.6-21.7C17.6,31.7,11.5,35,9.6,44.5 c-0.3,1.6-0.4,4,0.5,5.1s3,1.3,4.4,1.3c2.9,0,8.3-2.1,8.3-9.5c0-6.1-4-11.4-9.8-12.4c-6.2-1.1-12.8,3.7-12.8,11.9 c0,6.6,4.6,13.7,11.8,15.7V68c-1.7,0.7-5.5,1.7-5.5,5.1c0,2.6,2.2,4.6,4.8,4.6c2.8,0,5.2-2.1,5.2-5.4C16.5,69.5,16,69.1,15.8,55.1z"
            fill="black"
        />

        {/* Bass Clef */}
        <g transform={`translate(10, ${BASS_TOP_Y + 10}) scale(0.8)`}>
            <path d="M15,15 c-3,0 -6,3 -6,7 c0,5 4,8 8,8 c6,0 12,-5 12,-12 c0,-8 -7,-14 -15,-14 c-10,0 -12,10 -12,18 c0,9 6,15 14,15" fill="none" stroke="black" strokeWidth="3" />
            <circle cx="26" cy="11" r="2.5" fill="black" />
            <circle cx="34" cy="7" r="3" fill="black" />
            <circle cx="34" cy="23" r="3" fill="black" />
        </g>

        {/* Time Signature 4/4 */}
        <g transform={`translate(${PADDING_LEFT + 20}, ${TREBLE_TOP_Y})`} className="font-serif font-bold text-3xl select-none pointer-events-none">
            <text x="0" y="20">4</text>
            <text x="0" y="40">4</text>
        </g>
        <g transform={`translate(${PADDING_LEFT + 20}, ${BASS_TOP_Y})`} className="font-serif font-bold text-3xl select-none pointer-events-none">
            <text x="0" y="20">4</text>
            <text x="0" y="40">4</text>
        </g>


        {/* Render Notes */}
        {notes.map((note) => {
            const { y, isTreble, stemDirection, isSharp, step } = getNoteLayout(note.midi_pitch);
            const x = PADDING_LEFT + 60 + (note.start_time * PIXELS_PER_SECOND); // +60 offset for key sig/time sig
            
            const isSelected = selectedNoteId === note.id;
            
            let color = "black";
            let opacity = 1;

            if (isSelected) {
                color = "#4f46e5"; // Indigo-600
                opacity = 1;
            } else {
                // Confidence Color Mapping
                // High confidence notes are solid black (standard)
                // Medium/Low confidence notes are grey and semi-transparent (ghost notes)
                const conf = note.confidence || 0;
                if (conf >= 0.8) {
                    color = "#09090b"; // Zinc-950 (Black)
                    opacity = 1;
                } else if (conf >= 0.5) {
                    color = "#52525b"; // Zinc-600 (Dark Grey)
                    opacity = 0.85;
                } else {
                    color = "#a1a1aa"; // Zinc-400 (Light Grey)
                    opacity = 0.6;
                }
            }
            
            const stemX = stemDirection === 'up' ? x + NOTE_RADIUS_X - 0.5 : x - NOTE_RADIUS_X + 0.5;
            const stemHeight = 35;
            const stemY1 = y; 
            const stemY2 = stemDirection === 'up' ? y - stemHeight : y + stemHeight;

            let labelContent = null;
            if (labelSettings.showLabels && note.confidence >= labelSettings.minConfidence) {
                const labelData = formatPitch(note.midi_pitch, labelSettings);
                labelContent = labelData.display;
            }

            return (
                <g 
                    key={note.id} 
                    onClick={(e) => { e.stopPropagation(); onNoteClick(note.id); }}
                    className="cursor-pointer hover:opacity-100 transition-opacity duration-200 group"
                    style={{ opacity }}
                >
                    <title>Pitch: {Math.round(note.midi_pitch)} | Confidence: {Math.round(note.confidence * 100)}%</title>
                    
                    {renderLedgerLines(x, y, step, isTreble, color)}
                    
                    <line x1={stemX} y1={stemY1} x2={stemX} y2={stemY2} stroke={color} strokeWidth="1.5" />
                    
                    <g transform={`translate(${x}, ${y}) rotate(-20)`}>
                         <ellipse rx={NOTE_RADIUS_X} ry={NOTE_RADIUS_Y} fill={color} />
                    </g>
                    
                    {isSharp && (
                         <text x={x - 18} y={y + 5} fontSize="16" fill={color} fontFamily="serif">♯</text>
                    )}
                    
                    {labelContent && (
                        <text 
                            x={x} 
                            y={stemDirection === 'up' ? y + 20 : y - 20} 
                            fontSize="10" 
                            fontWeight="bold"
                            fill={isSelected ? "#4f46e5" : "#71717a"} 
                            textAnchor="middle"
                            className="pointer-events-none select-none"
                        >
                            {labelContent}
                        </text>
                    )}
                </g>
            );
        })}

        {/* Playhead */}
        <line 
            x1={PADDING_LEFT + 60 + (currentTime * PIXELS_PER_SECOND)} 
            y1={0} 
            x2={PADDING_LEFT + 60 + (currentTime * PIXELS_PER_SECOND)} 
            y2={320} 
            stroke="#ef4444" 
            strokeWidth="1.5"
        />
        <circle 
            cx={PADDING_LEFT + 60 + (currentTime * PIXELS_PER_SECOND)} 
            cy={TREBLE_TOP_Y - 20} 
            r={4} 
            fill="#ef4444" 
        />
      </svg>
    </div>
  );
};

export default SheetMusic;
