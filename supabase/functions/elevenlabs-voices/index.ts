import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY_1");
    if (!ELEVENLABS_API_KEY) {
      return new Response(JSON.stringify({ error: "Voice service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("ElevenLabs voices error:", res.status, errText);
      return new Response(JSON.stringify({ error: "Failed to fetch voices" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const voices = (data?.voices || []).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      labels: v.labels || {},
      category: v.category,
    }));

    return new Response(JSON.stringify({ voices }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("elevenlabs-voices error:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch voices" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
