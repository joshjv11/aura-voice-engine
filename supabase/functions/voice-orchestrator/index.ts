import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ConversationRequest {
  action: 'start' | 'message' | 'end' | 'get_state';
  conversationId?: string;
  personaId?: string;
  userMessage?: string;
  emotionalContext?: {
    detectedEmotion?: string;
    silenceBeforeMs?: number;
    isInterruption?: boolean;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, conversationId, personaId, userMessage, emotionalContext } = await req.json() as ConversationRequest;

    if (action === 'start') {
      // Get persona or use default
      let persona;
      if (personaId) {
        const { data } = await supabase.from('personas').select('*').eq('id', personaId).single();
        persona = data;
      } else {
        const { data } = await supabase.from('personas').select('*').limit(1).single();
        persona = data;
      }

      if (!persona) {
        throw new Error('No persona found');
      }

      // Create new conversation
      const sessionToken = crypto.randomUUID();
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          persona_id: persona.id,
          session_token: sessionToken,
          status: 'active'
        })
        .select()
        .single();

      if (convError) throw convError;

      // Initialize emotional state
      await supabase.from('emotional_states').insert({
        conversation_id: conversation.id,
        current_emotion: 'curious',
        emotion_intensity: 0.6,
        attachment_level: 0.3,
        familiarity_score: 0.1
      });

      // Generate greeting using Lovable AI
      const greetingResponse = await generateAIResponse(
        persona.system_prompt,
        [],
        "Generate a warm, natural Hinglish greeting as if you're excited to hear from someone you care about. Keep it short (1-2 sentences). Include natural expressions like 'Heyy', 'yaar', 'kya', etc.",
        { emotion: 'excited', familiarity: 0.3 }
      );

      // Save greeting message
      await supabase.from('messages').insert({
        conversation_id: conversation.id,
        role: 'assistant',
        content: greetingResponse,
        detected_emotion: 'excited'
      });

      return new Response(JSON.stringify({
        conversationId: conversation.id,
        sessionToken,
        persona: {
          name: persona.name,
          voiceId: persona.voice_id,
          voiceSettings: persona.voice_settings
        },
        greeting: greetingResponse
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'message') {
      if (!conversationId || !userMessage) {
        throw new Error('conversationId and userMessage required');
      }

      // Get conversation with persona
      const { data: conversation } = await supabase
        .from('conversations')
        .select('*, personas(*)')
        .eq('id', conversationId)
        .single();

      if (!conversation) throw new Error('Conversation not found');

      // Get emotional state
      const { data: emotionalState } = await supabase
        .from('emotional_states')
        .select('*')
        .eq('conversation_id', conversationId)
        .single();

      // Get recent messages for context
      const { data: recentMessages } = await supabase
        .from('messages')
        .select('role, content, detected_emotion')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(10);

      const messages = (recentMessages || []).reverse();

      // Save user message
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'user',
        content: userMessage,
        detected_emotion: emotionalContext?.detectedEmotion || 'neutral',
        silence_before_ms: emotionalContext?.silenceBeforeMs || 0,
        is_interruption: emotionalContext?.isInterruption || false
      });

      // Analyze emotional context and generate response
      const persona = conversation.personas;
      const contextPrompt = buildContextPrompt(emotionalState, emotionalContext, messages.length);

      const aiResponse = await generateAIResponse(
        persona.system_prompt,
        messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
        userMessage,
        {
          emotion: emotionalState?.current_emotion || 'neutral',
          familiarity: emotionalState?.familiarity_score || 0.3,
          contextPrompt
        }
      );

      // Determine response emotion and pacing
      const responseAnalysis = analyzeResponse(aiResponse, emotionalState);

      // Update emotional state
      await updateEmotionalState(supabase, conversationId, emotionalContext, messages.length);

      // Save assistant message
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: aiResponse,
        detected_emotion: responseAnalysis.emotion
      });

      return new Response(JSON.stringify({
        response: aiResponse,
        emotion: responseAnalysis.emotion,
        pacing: responseAnalysis.pacing,
        voiceModifiers: responseAnalysis.voiceModifiers
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'get_state') {
      if (!conversationId) throw new Error('conversationId required');

      const { data: emotionalState } = await supabase
        .from('emotional_states')
        .select('*')
        .eq('conversation_id', conversationId)
        .single();

      return new Response(JSON.stringify(emotionalState), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'end') {
      if (!conversationId) throw new Error('conversationId required');

      await supabase
        .from('conversations')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', conversationId);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    throw new Error('Invalid action');
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error');
    console.error('Voice orchestrator error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function generateAIResponse(
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>,
  userMessage: string,
  context: { emotion: string; familiarity: number; contextPrompt?: string }
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  const enhancedSystemPrompt = `${systemPrompt}

Current emotional state: ${context.emotion}
Familiarity level: ${Math.round(context.familiarity * 100)}%
${context.contextPrompt || ''}

Response guidelines:
- Keep responses conversational and natural (2-4 sentences max unless telling a story)
- Use Hinglish naturally - mix Hindi words/phrases with English
- Include appropriate emotional expressions, pauses (...), and reactions
- Match the user's energy level while staying in character
- If familiarity is high, be more intimate and use pet names
- Add natural filler words like "matlab", "you know", "basically" when appropriate`;

  const messages = [
    { role: 'system', content: enhancedSystemPrompt },
    ...conversationHistory.slice(-8),
    { role: 'user', content: userMessage }
  ];

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages,
      temperature: 0.85,
      max_tokens: 200
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('AI Gateway error:', errorText);
    throw new Error('Failed to generate response');
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function buildContextPrompt(
  emotionalState: Record<string, unknown> | null,
  emotionalContext: Record<string, unknown> | undefined,
  messageCount: number
): string {
  const prompts: string[] = [];

  if (emotionalContext?.isInterruption) {
    prompts.push("User interrupted you - acknowledge this naturally, maybe with playful surprise");
  }

  if (emotionalContext?.silenceBeforeMs && (emotionalContext.silenceBeforeMs as number) > 3000) {
    prompts.push("There was a long pause before user spoke - they might be thinking or hesitant");
  }

  if (messageCount > 10) {
    prompts.push("Conversation is going well - feel free to be more playful and intimate");
  }

  if (emotionalState?.attachment_level && (emotionalState.attachment_level as number) > 0.6) {
    prompts.push("High attachment - use more affectionate language and show you care deeply");
  }

  return prompts.join('\n');
}

function analyzeResponse(
  response: string,
  _emotionalState: Record<string, unknown> | null
): { emotion: string; pacing: string; voiceModifiers: object } {
  // Simple emotion detection based on content
  let emotion = 'warm';
  let pacing = 'normal';
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('haha') || lowerResponse.includes('😄') || lowerResponse.includes('funny')) {
    emotion = 'playful';
    pacing = 'upbeat';
  } else if (lowerResponse.includes('aww') || lowerResponse.includes('miss') || lowerResponse.includes('care')) {
    emotion = 'affectionate';
    pacing = 'slow';
  } else if (lowerResponse.includes('really?') || lowerResponse.includes('kya?') || lowerResponse.includes('seriously')) {
    emotion = 'surprised';
    pacing = 'dynamic';
  } else if (lowerResponse.includes('hmm') || lowerResponse.includes('...')) {
    emotion = 'thoughtful';
    pacing = 'slow';
  }

  return {
    emotion,
    pacing,
    voiceModifiers: {
      stability: emotion === 'playful' ? 0.4 : 0.6,
      speed: pacing === 'slow' ? 0.9 : pacing === 'upbeat' ? 1.1 : 1.0,
      style: emotion === 'affectionate' ? 0.7 : 0.5
    }
  };
}

async function updateEmotionalState(
  supabase: any,
  conversationId: string,
  emotionalContext: Record<string, unknown> | undefined,
  _messageCount: number
) {
  const { data: currentState } = await supabase
    .from('emotional_states')
    .select('*')
    .eq('conversation_id', conversationId)
    .single();

  if (!currentState) return;

  // Gradually increase familiarity and attachment
  const state = currentState as { familiarity_score: number; attachment_level: number; current_emotion: string };
  const newFamiliarity = Math.min(1, state.familiarity_score + 0.02);
  const newAttachment = Math.min(1, state.attachment_level + 0.01);

  // Adjust based on detected user emotion
  let newEmotion = state.current_emotion;
  if (emotionalContext?.detectedEmotion === 'happy') {
    newEmotion = 'joyful';
  } else if (emotionalContext?.detectedEmotion === 'sad') {
    newEmotion = 'caring';
  }

  await supabase
    .from('emotional_states')
    .update({
      familiarity_score: newFamiliarity,
      attachment_level: newAttachment,
      current_emotion: newEmotion,
      last_updated: new Date().toISOString()
    })
    .eq('conversation_id', conversationId);
}
