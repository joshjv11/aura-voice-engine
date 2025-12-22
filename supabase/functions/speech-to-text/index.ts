import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface STTRequest {
  audio: string; // base64 encoded audio
  language?: string;
  detectEmotion?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { audio, language, detectEmotion } = await req.json() as STTRequest;

    if (!audio) {
      throw new Error('Audio data is required');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('API key not configured');
    }

    // Use Lovable AI for transcription via Gemini multimodal
    const transcriptionResult = await transcribeWithGemini(audio, LOVABLE_API_KEY);

    const response: Record<string, unknown> = {
      text: transcriptionResult.text,
      language: transcriptionResult.detectedLanguage || 'hinglish'
    };

    // Optionally detect emotion from transcribed text
    if (detectEmotion && transcriptionResult.text) {
      const emotionResult = await detectEmotionFromText(transcriptionResult.text, LOVABLE_API_KEY);
      response.emotion = emotionResult.emotion;
      response.emotionConfidence = emotionResult.confidence;
    }

    console.log('STT Result:', { 
      textLength: (response.text as string)?.length, 
      emotion: response.emotion 
    });

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    console.error('STT error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function transcribeWithGemini(audioBase64: string, apiKey: string): Promise<{ text: string; detectedLanguage?: string }> {
  // For audio transcription, we'll use a multimodal approach
  // Gemini can process audio when sent as base64
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a speech-to-text transcription system specialized in Hinglish (Hindi-English code-mixed speech). 
Transcribe the audio content exactly as spoken, preserving:
- Hindi words in Roman script (not Devanagari)
- English words as-is
- Natural expressions, filler words, and interjections
- Emotional tone indicators if clearly audible

Return ONLY the transcribed text, nothing else.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe this audio:'
            },
            {
              type: 'input_audio',
              input_audio: {
                data: audioBase64,
                format: 'webm'
              }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    // Fallback: return empty if transcription fails
    console.error('Gemini transcription failed:', await response.text());
    return { text: '', detectedLanguage: 'unknown' };
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  
  // Detect if mostly Hindi or English
  const hindiPattern = /\b(hai|haan|nahi|kya|kaise|kyun|matlab|yaar|accha|theek)\b/gi;
  const hindiMatches = text.match(hindiPattern) || [];
  const detectedLanguage = hindiMatches.length > 2 ? 'hinglish' : 'english';

  return { text, detectedLanguage };
}

async function detectEmotionFromText(text: string, apiKey: string): Promise<{ emotion: string; confidence: number }> {
  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        {
          role: 'system',
          content: `Analyze the emotional tone of the text. Return a JSON object with:
- emotion: one of [happy, sad, angry, anxious, excited, neutral, loving, playful, frustrated]
- confidence: 0.0 to 1.0

Consider Hinglish expressions and their emotional context. Return ONLY the JSON.`
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    return { emotion: 'neutral', confidence: 0.5 };
  }

  try {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));
    return {
      emotion: parsed.emotion || 'neutral',
      confidence: parsed.confidence || 0.5
    };
  } catch {
    return { emotion: 'neutral', confidence: 0.5 };
  }
}
