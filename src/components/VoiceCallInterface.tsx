import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface VoiceCallInterfaceProps {
  onEndCall: () => void;
}

const VoiceCallInterface = ({ onEndCall }: VoiceCallInterfaceProps) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<'connecting' | 'active' | 'ended'>('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState('neutral');
  const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([]);

  const [lastUserSpeechTime, setLastUserSpeechTime] = useState(Date.now());

  const conversationIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isProcessingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isInterruptionRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  const startConversation = useCallback(async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/voice-orchestrator`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' })
        }
      );

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      conversationIdRef.current = data.conversationId;
      setTranscript([{ role: 'assistant', text: data.greeting }]);
      setStatus('active');

      // Play greeting audio
      await playTTS(data.greeting, 'excited');

      // Start listening
      await startListening();
    } catch (error) {
      console.error('Failed to start:', error);
      toast({ title: 'Connection failed', variant: 'destructive' });
      onEndCall();
    }
  }, [toast, onEndCall]);

  const playTTS = async (text: string, emotion: string, pace: number = 1.0): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        if (!text.trim()) {
          resolve();
          return;
        }

        // Ensure AudioContext is running (fix for autoplay blocks)
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
        }

        console.log('Calling Sarvam TTS for:', text, 'Pace:', pace);
        setIsSpeaking(true);

        let data;
        let usedModel = 'bulbul:v3-beta';

        try {
          // Attempt 1: Try v3-beta (Better quality, but might reject params)
          const response = await fetch('https://api.sarvam.ai/text-to-speech', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-subscription-key': 'sk_av2udgsa_X5NpkUJUYPLwoNJmpb9s5AA9' // Hardcoded for reliability
            },
            body: JSON.stringify({
              inputs: [text],
              target_language_code: 'hi-IN',
              speaker_gender: 'Female',
              model: 'bulbul:v3-beta',
              // Removed pace/pitch for v3 stability
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`v3 failed: ${errText}`);
          }
          data = await response.json();

        } catch (v3Error) {
          console.warn('Sarvam v3 failed, falling back to v1:', v3Error);
          usedModel = 'bulbul:v1';

          // Attempt 2: Fallback to v1 (Supports parameters)
          const response = await fetch('https://api.sarvam.ai/text-to-speech', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'api-subscription-key': 'sk_av2udgsa_X5NpkUJUYPLwoNJmpb9s5AA9'
            },
            body: JSON.stringify({
              inputs: [text],
              target_language_code: 'hi-IN',
              speaker_gender: 'Female',
              model: 'bulbul:v1',
              pitch: 0,
              pace: pace // v1 supports pace!
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`v1 fallback also failed: ${errText}`);
          }
          data = await response.json();
        }

        if (!data.audios || !data.audios[0]) {
          throw new Error('No audio data received from any model');
        }

        const binaryString = window.atob(data.audios[0]);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const audioBlob = new Blob([bytes], { type: 'audio/wav' });
        console.log('Audio Blob created, size:', audioBlob.size, 'Handling TTS...');

        const audioUrl = URL.createObjectURL(audioBlob);

        if (isInterruptionRef.current) {
          console.log('Interruption before play, skipping');
          resolve();
          return;
        }

        const audio = new Audio(audioUrl);
        audioRef.current = audio;

        // DEBUG: Force Volume 1.0 to rule out physics bugs
        audio.volume = 1.0;
        /* 
        // Voice Physics (Volume Illusion) - DISABLED For Debug
        switch (emotion) {
          case 'intimate':
          case 'affectionate':
            audio.volume = 0.8; // Closer/Softer
            break;
          case 'sad':
          case 'thoughtful':
            audio.volume = 0.7; // Quiet/Withdrawn
            break;
          case 'playful':
          case 'excited':
            audio.volume = 1.0; // Bright/Full
            break;
          default:
            audio.volume = 0.9;
        }
        */

        audio.onended = () => {
          console.log('Audio segment ended');
          setIsSpeaking(false);
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        audio.onerror = (e) => {
          console.error('Audio playback error', e);
          setIsSpeaking(false);
          resolve();
        };

        await audio.play().catch(e => {
          console.error('Play() failed (autoplay blocked?):', e);
          resolve();
        });

      } catch (error) {
        console.error('TTS execution error:', error);
        setIsSpeaking(false);
        resolve(); // Always resolve to ensure loop continues
      }
    });
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);

          // VAD: Check Volume Threshold (Phase 4)
          // We need an AnalyserNode for real-time volume, but MediaRecorder only gives blobs.
          // For now, we trust the 'isInterruption' flag if we had a proper VAD. 
          // Since we don't have a VAD processor running, we will use a simplified assumption:
          // If the chunk size is remarkably large, it *might* be speech, but that's unreliable.
          // Ideally, we'd use an AudioContext + ScriptProcessor/AudioWorklet *in parallel* to MediaRecorder.
          // Due to complexity, I will enable a 'Soft Interruption' that requires > 3 chunks of data (>300ms) to trigger.

          if (isSpeaking && !isInterruptionRef.current) {
            // Simple counter to avoid instant noise trigger
            // (This is a hack until full VAD is implemented)
            // isInterruptionRef.current = true; // Still disabled for safety until AudioContext VAD is ready.
          }
        }
      };

      // VAD Implementation (Parallel AudioContext)
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext; // Store context in ref
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive' || audioContext.state === 'closed') return;

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Threshold of ~20-30 usually filters breath/noise
        if (average > 30 && isSpeaking) {
          console.log('VAD: User speaking (Vol:', average, ') -> Stopping AI');
          // isInterruptionRef.current = true;
          // Stop immediately
          /* 
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
            setIsSpeaking(false);
          } 
          */
          console.warn("VAD Triggered but ACTION DISABLED for stability (Silent Audio Fix)");
        }
        requestAnimationFrame(checkVolume);
      };

      checkVolume();


      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length === 0 || isProcessingRef.current) return;

        isProcessingRef.current = true;
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        await processUserAudio(audioBlob);
        isProcessingRef.current = false;

        // Restart recording if still active
        if (status === 'active' && mediaRecorderRef.current) {
          mediaRecorderRef.current.start();
          setTimeout(() => mediaRecorderRef.current?.stop(), 5000);
        }
      };

      mediaRecorder.start();
      setTimeout(() => mediaRecorder.stop(), 5000);
    } catch (error) {
      console.error('Mic error:', error);
      toast({ title: 'Microphone access required', variant: 'destructive' });
    }
  };

  // Debug Tool: Test Audio Output
  const testAudio = async () => {
    try {
      console.log('Testing Audio Output...');
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      console.log('Test beep played.');
      toast({ title: "Diagnostics", description: "Playing test beep..." });
    } catch (e) {
      console.error('Test Audio Failed:', e);
      toast({ title: "Error", description: "Audio engine failed to play beep." });
    }
  };

  const processUserAudio = async (audioBlob: Blob) => {
    // ... (existing code, untouched)
    // I am just inserting the testAudio function before it.
    // But wait, replace_file_content replaces the BLOCK.
    // I need to be careful not to delete processUserAudio.
    // I will only RETURN the testAudio function and rely on the user to insert it correctly? 
    // No, I must provide valid replacement.
    // Let me target where to insert `testAudio` more precisely or include processUserAudio start.
  };

  const processUserAudio = async (audioBlob: Blob) => {
    try {
      const base64 = await blobToBase64(audioBlob);

      // Transcribe
      const sttResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speech-to-text`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, detectEmotion: true })
        }
      );

      const sttData = await sttResponse.json();
      if (!sttData.text || sttData.text.length < 2) return;

      setTranscript(prev => [...prev, { role: 'user', text: sttData.text }]);

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
              detectedEmotion: sttData.emotion,
              silenceBeforeMs: Date.now() - lastUserSpeechTime,
              isInterruption: isInterruptionRef.current
            }
          })
        }
      );

      const aiData = await response.json();
      if (aiData.error) throw new Error(aiData.error);

      setCurrentEmotion(aiData.emotion);
      setTranscript(prev => [...prev, { role: 'assistant', text: aiData.response }]);

      await playTTS(aiData.response, aiData.emotion);
    } catch (error) {
      console.error('Processing error:', error);
    } finally {
      setLastUserSpeechTime(Date.now());
      isInterruptionRef.current = false;
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

    mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
    setStatus('ended');
    onEndCall();
  };

  useEffect(() => {
    startConversation();
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
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
          {status === 'connecting' ? 'Connecting...' : isSpeaking ? 'Speaking...' : 'Listening...'}
        </p>
      </div>

      {/* Transcript */}
      <div className="h-48 overflow-y-auto space-y-2 p-4 bg-muted/30 rounded-lg">
        {transcript.map((msg, i) => (
          <div key={i} className={`text-sm ${msg.role === 'user' ? 'text-right text-muted-foreground' : 'text-left'}`}>
            {msg.text}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex justify-center gap-4">
        <Button
          variant="outline"
          size="icon"
          className="w-14 h-14 rounded-full"
          onClick={() => setIsMuted(!isMuted)}
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

        <Button
          variant="ghost"
          size="sm"
          className="absolute top-4 right-4 text-xs"
          onClick={testAudio}
        >
          Test Sound
        </Button>
      </div>
    </div>
  );
};

export default VoiceCallInterface;
