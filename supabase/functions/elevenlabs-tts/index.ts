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

    // INDIAN FEMALE VOICES - Best for Hinglish:
    // Charlotte (Rachel clone trained on Indian English) - XrExE9yKIg1WjnnlVkGX (Matilda - close)
    // Using Jessica - versatile, can sound Indian with Hindi words
    // Priya (community voice) or we use Jessica with multilingual
    
    // Best approach: Use eleven_multilingual_v2 with Hindi/Indian inflections in text
    // "Charlotte" - cgSgspJ2msm6clMCkdW9 (Jessica) is versatile for Indian content
    // "Aria" style female for warmth
    
    // Using Aria (21m00Tcm4TlvDq8ikWAM) - warm, expressive female voice
    // Or Jessica (cgSgspJ2msm6clMCkdW9) - clear, versatile
    const selectedVoiceId = voiceId || 'cgSgspJ2msm6clMCkdW9'; // Jessica - clear, works well with Hindi

    // Voice settings optimized for Indian/Hindi speech patterns
    const voiceSettings = getEmotionSettings(emotion || 'neutral');

    // ALWAYS use eleven_multilingual_v2 for proper Hindi pronunciation
    // It naturally adopts Indian accent when processing Hinglish text
    const modelId = 'eleven_multilingual_v2';

    // Use streaming for lowest latency
    const endpoint = streaming
      ? `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}/stream?output_format=mp3_22050_32`
      : `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}?output_format=mp3_44100_128`;

    // Process text for better Hindi pronunciation
    const processedText = processHinglishText(text);
    
    console.log(`ElevenLabs TTS: "${processedText.substring(0, 50)}..." model: ${modelId}, emotion: ${emotion}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: processedText,
        model_id: modelId,
        voice_settings: voiceSettings,
        // Language hint for better Hindi pronunciation
        language_code: 'hi', // Hindi - helps with pronunciation
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('ElevenLabs API error:', response.status, errText);
      return new Response(
        JSON.stringify({ error: `TTS failed: ${response.status}`, details: errText }),
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
  // Voice settings tuned for warm, natural Indian female voice
  // Lower stability = more expressive, higher style = more emotional
  const settings: Record<string, { stability: number; similarity_boost: number; style: number; speed: number }> = {
    playful: { stability: 0.30, similarity_boost: 0.85, style: 0.65, speed: 1.05 },
    affectionate: { stability: 0.40, similarity_boost: 0.90, style: 0.55, speed: 0.92 },
    thoughtful: { stability: 0.50, similarity_boost: 0.80, style: 0.35, speed: 0.88 },
    excited: { stability: 0.25, similarity_boost: 0.85, style: 0.75, speed: 1.1 },
    calm: { stability: 0.60, similarity_boost: 0.75, style: 0.25, speed: 0.90 },
    teasing: { stability: 0.30, similarity_boost: 0.85, style: 0.70, speed: 1.02 },
    warm: { stability: 0.45, similarity_boost: 0.85, style: 0.50, speed: 0.95 },
    caring: { stability: 0.45, similarity_boost: 0.88, style: 0.45, speed: 0.90 },
    neutral: { stability: 0.45, similarity_boost: 0.80, style: 0.45, speed: 0.98 },
  };

  return {
    ...settings[emotion] || settings.neutral,
    use_speaker_boost: true,
  };
}

function processHinglishText(text: string): string {
  // Process text to improve Hindi/Hinglish pronunciation
  let processed = text
    // Remove voice instruction brackets (they shouldn't be spoken)
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    // Clean markdown
    .replace(/[\*\_\#]/g, '')
    // Add slight pauses for natural flow
    .replace(/\.{3,}/g, '...')
    // Improve Hindi word pronunciation by adding phonetic hints
    // Common Hinglish words - slight adjustments for better pronunciation
    .replace(/\byaar\b/gi, 'yaar')
    .replace(/\bkya\b/gi, 'kyaa')
    .replace(/\bhai\b/gi, 'hai')
    .replace(/\bacha\b/gi, 'achhaa')
    .replace(/\bachha\b/gi, 'achhaa')
    .replace(/\bnahi\b/gi, 'nahee')
    .replace(/\bhaan\b/gi, 'haañ')
    .replace(/\bmatlab\b/gi, 'matlab')
    .replace(/\bsuno\b/gi, 'suno')
    .replace(/\bkaise\b/gi, 'kaise')
    .replace(/\bkyun\b/gi, 'kyuñ')
    .replace(/\bthik\b/gi, 'theek')
    .replace(/\btheek\b/gi, 'theek')
    .replace(/\bbolo\b/gi, 'bolo')
    .replace(/\bchalo\b/gi, 'chalo')
    .replace(/\bbaat\b/gi, 'baat')
    .replace(/\bpata\b/gi, 'pataa')
    .replace(/\btum\b/gi, 'tum')
    .replace(/\bmujhe\b/gi, 'mujhe')
    .replace(/\baaj\b/gi, 'aaj')
    .replace(/\bkab\b/gi, 'kab')
    .replace(/\babhi\b/gi, 'abhee')
    .trim();

  return processed;
}
