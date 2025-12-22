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
  
  const conversationIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isProcessingRef = useRef(false);

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

  const playTTS = async (text: string, emotion: string) => {
    try {
      setIsSpeaking(true);
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/text-to-speech`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, emotion })
        }
      );

      if (!response.ok) throw new Error('TTS failed');

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => setIsSpeaking(false);
      await audio.play();
    } catch (error) {
      console.error('TTS error:', error);
      setIsSpeaking(false);
    }
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

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
            emotionalContext: { detectedEmotion: sttData.emotion }
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
      </div>
    </div>
  );
};

export default VoiceCallInterface;
