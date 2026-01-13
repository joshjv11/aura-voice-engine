import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
        setIsSpeaking(true);

        // Use ElevenLabs via edge function for premium voice quality
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-tts`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({
              text,
              emotion,
              streaming: true, // Use streaming for lowest latency
            }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          console.error('TTS failed:', response.status, errText);
          throw new Error(`TTS failed: ${response.status}`);
        }

        // Get audio blob from streaming response
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
          setIsSpeaking(false);
          audioRef.current = null;
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        audio.onerror = (e) => {
          console.error('Audio playback error:', e);
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          resolve();
        };

        // Start playback immediately
        await audio.play();

      } catch (error) {
        console.error('TTS error:', error);
        setIsSpeaking(false);
        resolve();
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
        }
      };

      // VAD via AudioContext
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkVolume = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Threshold for interruption detection
        if (average > 35 && isSpeaking && audioRef.current) {
          console.log('VAD: User speaking during AI speech, triggering soft interrupt');
          isInterruptionRef.current = true;
          // Soft stop: fade out instead of hard cut
          audioRef.current.volume = Math.max(0, audioRef.current.volume - 0.1);
          if (audioRef.current.volume <= 0.1) {
            audioRef.current.pause();
            audioRef.current = null;
            setIsSpeaking(false);
          }
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
      toast({ title: "Test beep playing" });
    } catch (e) {
      console.error('Test Audio Failed:', e);
      toast({ title: "Audio test failed", variant: "destructive" });
    }
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

      // Get AI response with speech plan
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

      // Apply thinking delay before speaking
      if (aiData.thinkingDelayMs > 0) {
        await new Promise(r => setTimeout(r, aiData.thinkingDelayMs));
      }

      // Play TTS with speech plan segments
      if (aiData.speechPlan?.segments) {
        for (const segment of aiData.speechPlan.segments) {
          if (isInterruptionRef.current) break;
          await playTTS(segment.text, aiData.emotion, segment.pace || 1.0);
          if (segment.pauseAfterMs && segment.pauseAfterMs > 0) {
            await new Promise(r => setTimeout(r, segment.pauseAfterMs));
          }
        }
      } else {
        await playTTS(aiData.response, aiData.emotion);
      }

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
    <div className="w-full max-w-md mx-auto space-y-6 relative">
      {/* Test Sound Button */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-0 right-0 text-xs"
        onClick={testAudio}
      >
        Test Sound
      </Button>

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
      </div>
    </div>
  );
};

export default VoiceCallInterface;
