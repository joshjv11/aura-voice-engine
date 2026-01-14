import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface VoiceCallInterfaceProps {
  onEndCall: () => void;
}

const VoiceCallInterface = ({ onEndCall }: VoiceCallInterfaceProps) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<'connecting' | 'active' | 'ended'>('connecting');
  const [uiPhase, setUiPhase] = useState<
    'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'ended'
  >('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState('neutral');
  const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([]);
  const [lastUserSpeechTime, setLastUserSpeechTime] = useState(Date.now());

  const [voices, setVoices] = useState<
    Array<{ voice_id: string; name: string; labels?: Record<string, string> }>
  >([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('cgSgspJ2msm6clMCkdW9');

  const isSpeaking = uiPhase === 'speaking';
  const isListening = uiPhase === 'listening';

  const conversationIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isProcessingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isInterruptionRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRecordingRef = useRef(false);
  const recordingStartRef = useRef<number | null>(null);
  const vadAnimationRef = useRef<number | null>(null);

  // VAD configuration (lower values = faster turn-taking)
  const SILENCE_THRESHOLD_RMS = 0.014; // RMS threshold (0..1) for "voice present"
  const SILENCE_DURATION = 650; // ms of silence before we stop + process
  const MIN_SPEECH_DURATION = 250; // ms minimum speech before considering valid
  const MAX_RECORDING_MS = 12000; // hard cap so we never upload huge blobs

  const startConversation = useCallback(async () => {
    try {
      setUiPhase('connecting');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-orchestrator`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ action: 'start' })
        }
      );

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      conversationIdRef.current = data.conversationId;
      setTranscript([{ role: 'assistant', text: data.greeting }]);
      setStatus('active');

      // Play greeting audio
      setUiPhase('thinking');
      await playTTS(data.greeting, 'excited');

      // Start continuous listening with VAD
      await startContinuousListening();
    } catch (error) {
      console.error('Failed to start:', error);
      toast({ title: 'Connection failed', variant: 'destructive' });
      onEndCall();
    }
  }, [toast, onEndCall]);

  const playTTS = async (text: string, emotion: string): Promise<void> => {
    return new Promise(async (resolve) => {
      try {
        if (!text.trim()) {
          resolve();
          return;
        }

        // Ensure AudioContext is running
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        console.log('🎤 ElevenLabs TTS:', text.substring(0, 50) + '...', 'Emotion:', emotion);

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              text,
              emotion,
              voiceId: selectedVoiceId,
              streaming: false,
            }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          console.error('TTS failed:', response.status, errText);
          throw new Error(`TTS failed: ${response.status}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        if (isInterruptionRef.current) {
          console.log('Interruption before play, skipping');
          URL.revokeObjectURL(audioUrl);
          resolve();
          return;
        }

        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.volume = 1.0;

        audio.onended = () => {
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          if (status === 'active' && !isMuted) setUiPhase('listening');
          resolve();
        };

        audio.onerror = (e) => {
          console.error('Audio playback error:', e);
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          if (status === 'active' && !isMuted) setUiPhase('listening');
          resolve();
        };

        setUiPhase('speaking');
        await audio.play();

      } catch (error) {
        console.error('TTS error:', error);
        if (status === 'active' && !isMuted) setUiPhase('listening');
        resolve();
      }
    });
  };

  const startContinuousListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;

      // Setup audio context for VAD
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length === 0 || isProcessingRef.current) {
          // Restart recording immediately
          if (status === 'active' && !isMuted && streamRef.current) {
            startRecording();
          }
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];
        
        // Only process if we have meaningful audio
        if (audioBlob.size > 1000) {
          await processUserAudio(audioBlob);
        }

        // Restart recording after processing
        if (status === 'active' && !isMuted && streamRef.current) {
          startRecording();
        }
      };

      // Start VAD monitoring
      startVADMonitoring();
      
      // Start initial recording
      startRecording();
      setUiPhase('listening');

    } catch (error) {
      console.error('Mic error:', error);
      toast({ title: 'Microphone access required', variant: 'destructive' });
    }
  };

  const startRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
      audioChunksRef.current = [];
      mediaRecorderRef.current.start(100); // Collect data every 100ms
      isRecordingRef.current = true;
      console.log('🎙️ Recording started');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      isRecordingRef.current = false;
      console.log('🎙️ Recording stopped');
    }
  };

  const startVADMonitoring = () => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let speechStartTime: number | null = null;
    let lastSpeechTime = Date.now();

    const checkVoiceActivity = () => {
      if (!analyserRef.current || status !== 'active') return;

      analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;

      const isSpeakingNow = average > SILENCE_THRESHOLD_RMS * 255;
      const now = Date.now();

      if (isSpeakingNow) {
        if (!speechStartTime) {
          speechStartTime = now;
        }
        lastSpeechTime = now;

        // Clear any pending silence timeout
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }

        // Handle interruption if AI is speaking
        if (audioRef.current && !isInterruptionRef.current) {
          const speechDuration = now - speechStartTime;
          if (speechDuration > MIN_SPEECH_DURATION) {
            console.log('🔇 User interrupting AI, fading out');
            isInterruptionRef.current = true;
            // Soft fade out
            const fadeOut = setInterval(() => {
              if (audioRef.current) {
                audioRef.current.volume = Math.max(0, audioRef.current.volume - 0.15);
                if (audioRef.current.volume <= 0.1) {
                  audioRef.current.pause();
                  audioRef.current = null;
                  setUiPhase('listening');
                  clearInterval(fadeOut);
                }
              } else {
                clearInterval(fadeOut);
              }
            }, 50);
          }
        }
      } else {
        // Silence detected
        const silenceDuration = now - lastSpeechTime;
        
        if (speechStartTime && silenceDuration > SILENCE_DURATION && isRecordingRef.current) {
          const totalSpeechDuration = lastSpeechTime - speechStartTime;
          
          if (totalSpeechDuration > MIN_SPEECH_DURATION) {
            console.log(`🔇 Silence detected after ${totalSpeechDuration}ms of speech, processing...`);
            speechStartTime = null;
            stopRecording();
          }
        }
      }

      vadAnimationRef.current = requestAnimationFrame(checkVoiceActivity);
    };

    checkVoiceActivity();
  };

  const processUserAudio = async (audioBlob: Blob) => {
    if (isProcessingRef.current) return;
    
    isProcessingRef.current = true;
    setUiPhase('transcribing');

    try {
      const base64 = await blobToBase64(audioBlob);

      console.log('📝 Transcribing audio...');
      const sttResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech-to-text`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, detectEmotion: true })
        }
      );

      const sttData = await sttResponse.json();
      console.log('📝 Transcription result:', sttData.text);

      if (!sttData.text || sttData.text.trim().length < 2) {
        console.log('⚠️ Empty or too short transcription, skipping');
        isProcessingRef.current = false;
        setUiPhase('listening');
        return;
      }
      
      setUiPhase('thinking');

      // Add user message to transcript
      setTranscript(prev => [...prev, { role: 'user', text: sttData.text }]);

      console.log('🤖 Getting AI response for:', sttData.text);
      
      // Get AI response
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-orchestrator`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'message',
            conversationId: conversationIdRef.current,
            userMessage: sttData.text,
            emotionalContext: {
              detectedEmotion: sttData.emotion || 'neutral',
              silenceBeforeMs: Date.now() - lastUserSpeechTime,
              isInterruption: isInterruptionRef.current
            }
          })
        }
      );

      const aiData = await response.json();
      console.log('🤖 AI Response:', aiData.response);

      if (aiData.error) throw new Error(aiData.error);

      setCurrentEmotion(aiData.emotion || 'neutral');
      setTranscript(prev => [...prev, { role: 'assistant', text: aiData.response }]);

      // Apply thinking delay
      if (aiData.thinkingDelayMs > 0) {
        await new Promise(r => setTimeout(r, Math.min(aiData.thinkingDelayMs, 500)));
      }

      // Play TTS response
      isInterruptionRef.current = false;
      await playTTS(aiData.response, aiData.emotion || 'warm');

    } catch (error) {
      console.error('Processing error:', error);
      toast({ title: 'Error processing audio', variant: 'destructive' });
    } finally {
      setLastUserSpeechTime(Date.now());
      isInterruptionRef.current = false;
      isProcessingRef.current = false;
      if (status === 'active' && !isMuted) setUiPhase('listening');
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const endCall = async () => {
    // Cleanup
    if (vadAnimationRef.current) {
      cancelAnimationFrame(vadAnimationRef.current);
    }
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    if (conversationIdRef.current) {
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-orchestrator`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'end', conversationId: conversationIdRef.current })
        }
      );
    }

    setStatus('ended');
    onEndCall();
  };

  const toggleMute = () => {
    setIsMuted(prev => {
      const newMuted = !prev;
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(track => {
          track.enabled = !newMuted;
        });
      }
      return newMuted;
    });
  };

  useEffect(() => {
    startConversation();
    return () => {
      if (vadAnimationRef.current) {
        cancelAnimationFrame(vadAnimationRef.current);
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return (
    <div className="w-full max-w-md mx-auto space-y-6 relative">
      {/* Avatar */}
      <div className="relative mx-auto w-32 h-32">
        <div className={`w-full h-full rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-5xl transition-all ${isSpeaking ? 'animate-pulse scale-105' : ''}`}>
          💜
        </div>
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-background border rounded-full text-xs">
          {currentEmotion}
        </div>
      </div>

      {/* Status */}
      <div className="text-center">
        <p className="text-lg font-medium">Priya</p>
        <p className="text-sm text-muted-foreground">
          {status === 'connecting' ? 'Connecting...' : 
           isSpeaking ? 'Speaking...' : 
           isProcessingRef.current ? 'Thinking...' :
           isListening ? 'Listening...' : 'Ready'}
        </p>
        {isMuted && <p className="text-xs text-destructive mt-1">Muted</p>}
      </div>

      {/* Transcript */}
      <div className="h-48 overflow-y-auto space-y-2 p-4 bg-muted/30 rounded-lg">
        {transcript.map((msg, i) => (
          <div key={i} className={`text-sm ${msg.role === 'user' ? 'text-right text-muted-foreground' : 'text-left'}`}>
            <span className="text-xs opacity-60 mr-1">{msg.role === 'user' ? 'You:' : 'Priya:'}</span>
            {msg.text}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex justify-center gap-4">
        <Button
          variant={isMuted ? "destructive" : "outline"}
          size="icon"
          className="w-14 h-14 rounded-full"
          onClick={toggleMute}
        >
          {isMuted ? <MicOff /> : <Mic />}
        </Button>

        <Button
          variant="destructive"
          size="icon"
          className="w-14 h-14 rounded-full"
          onClick={endCall}
        >
          <PhoneOff />
        </Button>
      </div>
    </div>
  );
};

export default VoiceCallInterface;
