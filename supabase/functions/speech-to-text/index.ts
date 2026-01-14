import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface STTRequest {
  audio: string; // base64 encoded audio (webm)
  language?: string; // ISO 639-3 (e.g., 'hin')
  detectEmotion?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { audio, language, detectEmotion } = (await req.json()) as STTRequest;

    if (!audio) throw new Error("Audio data is required");

    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY_1");

    if (!ELEVENLABS_API_KEY) {
      throw new Error("STT service not configured");
    }

    const audioBytes = base64Decode(audio);
    const audioBlob = new Blob([audioBytes], { type: "audio/webm" });

    const apiFormData = new FormData();
    apiFormData.append("file", audioBlob, "audio.webm");
    apiFormData.append("model_id", "scribe_v1");

    // Optional: if you know user is speaking Hindi-heavy Hinglish, this can help.
    // If not provided, ElevenLabs will auto-detect.
    if (language) {
      apiFormData.append("language_code", language);
    }

    const sttRes = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
      },
      body: apiFormData,
    });

    if (!sttRes.ok) {
      const errText = await sttRes.text();
      console.error("ElevenLabs STT error:", sttRes.status, errText);
      throw new Error(`STT failed: ${sttRes.status}`);
    }

    const sttData = await sttRes.json();
    const text: string = sttData?.text || "";

    const response: Record<string, unknown> = {
      text,
      language: language || sttData?.language_code || "auto",
    };

    // Optional emotion detection (disabled client-side by default for latency)
    if (detectEmotion && text) {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (LOVABLE_API_KEY) {
        const emotionResult = await detectEmotionFromText(text, LOVABLE_API_KEY);
        response.emotion = emotionResult.emotion;
        response.emotionConfidence = emotionResult.confidence;
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Unknown error");
    console.error("STT error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function detectEmotionFromText(
  text: string,
  apiKey: string,
): Promise<{ emotion: string; confidence: number }> {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: `Analyze the emotional tone of the text. Return a JSON object with:\n- emotion: one of [happy, sad, angry, anxious, excited, neutral, loving, playful, frustrated]\n- confidence: 0.0 to 1.0\n\nConsider Hinglish expressions and their emotional context. Return ONLY the JSON.`,
        },
        { role: "user", content: text },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) return { emotion: "neutral", confidence: 0.5 };

  try {
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ""));
    return {
      emotion: parsed.emotion || "neutral",
      confidence: parsed.confidence || 0.5,
    };
  } catch {
    return { emotion: "neutral", confidence: 0.5 };
  }
}
