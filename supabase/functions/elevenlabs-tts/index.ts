import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, voiceId, emotion, streaming } = await req.json();

    if (!text || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'No text provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY_1');
    if (!ELEVENLABS_API_KEY) {
      console.error('ELEVENLABS_API_KEY_1 not configured');
      return new Response(
        JSON.stringify({ error: 'TTS service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use "Lily" voice - warm, friendly female voice perfect for intimate conversations
    // Also great for Indian English/Hinglish with natural accent
    const selectedVoiceId = voiceId || 'pFZP5JQG7iQjIQuC4Bku'; // Lily - warm, friendly

    // Adjust voice settings based on emotion for natural prosody
    const voiceSettings = getEmotionSettings(emotion || 'neutral');

    // Use turbo model for lowest latency
    const modelId = streaming ? 'eleven_turbo_v2_5' : 'eleven_multilingual_v2';

    // Streaming endpoint for real-time playback
    const endpoint = streaming
      ? `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}/stream?output_format=mp3_22050_32`
      : `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}?output_format=mp3_44100_128`;

    console.log(`ElevenLabs TTS: "${text.substring(0, 50)}..." with ${modelId}, emotion: ${emotion}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: processTextForSpeech(text),
        model_id: modelId,
        voice_settings: voiceSettings,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('ElevenLabs API error:', response.status, errText);
      return new Response(
        JSON.stringify({ error: `TTS failed: ${response.status}` }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For streaming, pass through the response body directly
    if (streaming) {
      return new Response(response.body, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'audio/mpeg',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // For non-streaming, return complete audio
    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    });

  } catch (error) {
    console.error('TTS error:', error);
    return new Response(
      JSON.stringify({ error: 'TTS processing failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getEmotionSettings(emotion: string) {
  // Voice settings tuned for intimate, natural conversation
  const settings: Record<string, { stability: number; similarity_boost: number; style: number; speed: number }> = {
    playful: { stability: 0.35, similarity_boost: 0.8, style: 0.6, speed: 1.05 },
    affectionate: { stability: 0.45, similarity_boost: 0.85, style: 0.5, speed: 0.95 },
    thoughtful: { stability: 0.55, similarity_boost: 0.75, style: 0.3, speed: 0.9 },
    excited: { stability: 0.3, similarity_boost: 0.8, style: 0.7, speed: 1.1 },
    calm: { stability: 0.65, similarity_boost: 0.7, style: 0.2, speed: 0.9 },
    teasing: { stability: 0.35, similarity_boost: 0.8, style: 0.65, speed: 1.0 },
    neutral: { stability: 0.5, similarity_boost: 0.75, style: 0.4, speed: 1.0 },
  };

  return {
    ...settings[emotion] || settings.neutral,
    use_speaker_boost: true,
  };
}

function processTextForSpeech(text: string): string {
  // Add natural prosody markers
  let processed = text
    // Clean markdown/formatting
    .replace(/[\*\_\#\[\]\(\)]/g, '')
    // Add pauses for ellipsis
    .replace(/\.{3}/g, '...')
    // Add subtle pause after commas in Hinglish
    .replace(/,\s*/g, ', ')
    // Handle common Hinglish contractions naturally
    .replace(/\bkya\b/gi, 'kyaa')
    .replace(/\bhai\b/gi, 'hai')
    .replace(/\bkaise\b/gi, 'kaise')
    .replace(/\bacha\b/gi, 'achha')
    .trim();

  return processed;
}
