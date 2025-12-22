import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TTSRequest {
  text: string;
  voiceId?: string;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    speed?: number;
  };
  emotion?: string;
  streaming?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voiceId, voiceSettings, emotion, streaming } = await req.json() as TTSRequest;

    if (!text) {
      throw new Error('Text is required');
    }

    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    if (!ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key not configured');
    }

    // Default voice for Hinglish female
    const selectedVoiceId = voiceId || 'pFZP5JQG7iQjIQuC4Bku'; // Lily - warm female voice

    // Adjust voice settings based on emotion
    const emotionSettings = getEmotionSettings(emotion || 'neutral');
    const finalSettings = {
      stability: voiceSettings?.stability ?? emotionSettings.stability,
      similarity_boost: voiceSettings?.similarity_boost ?? 0.75,
      style: voiceSettings?.style ?? emotionSettings.style,
      use_speaker_boost: true
    };

    const endpoint = streaming 
      ? `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}/stream`
      : `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`;

    console.log('TTS Request:', { text: text.substring(0, 50), voiceId: selectedVoiceId, emotion });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: processTextForSpeech(text),
        model_id: 'eleven_multilingual_v2',
        voice_settings: finalSettings
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs error:', errorText);
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    if (streaming) {
      return new Response(response.body, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'audio/mpeg',
          'Transfer-Encoding': 'chunked'
        }
      });
    }

    const audioBuffer = await response.arrayBuffer();
    
    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg'
      }
    });

  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    console.error('TTS error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function getEmotionSettings(emotion: string): { stability: number; style: number } {
  const settings: Record<string, { stability: number; style: number }> = {
    'playful': { stability: 0.4, style: 0.7 },
    'affectionate': { stability: 0.6, style: 0.6 },
    'excited': { stability: 0.35, style: 0.8 },
    'thoughtful': { stability: 0.7, style: 0.4 },
    'teasing': { stability: 0.45, style: 0.65 },
    'caring': { stability: 0.65, style: 0.55 },
    'joyful': { stability: 0.4, style: 0.75 },
    'warm': { stability: 0.55, style: 0.5 },
    'neutral': { stability: 0.5, style: 0.5 }
  };

  return settings[emotion] || settings['neutral'];
}

function processTextForSpeech(text: string): string {
  // Add natural pauses for better prosody
  let processed = text;

  // Convert ... to SSML-like pauses (ElevenLabs understands these)
  processed = processed.replace(/\.\.\./g, '... ');

  // Add slight pauses after common Hinglish expressions
  const hinglishExpressions = ['yaar', 'na', 'matlab', 'basically', 'accha', 'haan'];
  hinglishExpressions.forEach(expr => {
    const regex = new RegExp(`\\b${expr}\\b`, 'gi');
    processed = processed.replace(regex, `${expr},`);
  });

  // Ensure questions have proper intonation markers
  if (processed.includes('kya') && !processed.includes('?')) {
    processed = processed.replace(/kya\s/gi, 'kya? ');
  }

  return processed;
}
