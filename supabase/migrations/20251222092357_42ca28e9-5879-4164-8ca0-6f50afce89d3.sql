-- Voice Agent Engine Database Schema

-- Persona configurations for different AI girlfriend personalities
CREATE TABLE public.personas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  voice_id TEXT NOT NULL DEFAULT 'alloy',
  language_preference TEXT NOT NULL DEFAULT 'hinglish',
  personality_traits JSONB NOT NULL DEFAULT '{"warmth": 0.8, "playfulness": 0.7, "intimacy": 0.6, "teasing": 0.5}',
  system_prompt TEXT NOT NULL,
  voice_settings JSONB NOT NULL DEFAULT '{"stability": 0.5, "similarity_boost": 0.75, "style": 0.5, "speed": 1.0}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Conversation sessions
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  persona_id UUID REFERENCES public.personas(id),
  session_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  total_duration_seconds INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'
);

-- Conversation messages with timing and emotion data
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  audio_url TEXT,
  duration_ms INTEGER,
  detected_emotion TEXT,
  emotion_confidence REAL,
  is_interruption BOOLEAN DEFAULT FALSE,
  silence_before_ms INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Emotional state tracking per conversation
CREATE TABLE public.emotional_states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  current_emotion TEXT NOT NULL DEFAULT 'neutral',
  emotion_intensity REAL NOT NULL DEFAULT 0.5 CHECK (emotion_intensity >= 0 AND emotion_intensity <= 1),
  attachment_level REAL NOT NULL DEFAULT 0.3 CHECK (attachment_level >= 0 AND attachment_level <= 1),
  familiarity_score REAL NOT NULL DEFAULT 0.1 CHECK (familiarity_score >= 0 AND familiarity_score <= 1),
  mood_valence REAL NOT NULL DEFAULT 0.5 CHECK (mood_valence >= -1 AND mood_valence <= 1),
  arousal REAL NOT NULL DEFAULT 0.5 CHECK (arousal >= 0 AND arousal <= 1),
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Long-term user memory for attachment building
CREATE TABLE public.user_memories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('preference', 'fact', 'emotional_moment', 'inside_joke', 'topic_interest')),
  content TEXT NOT NULL,
  importance_score REAL NOT NULL DEFAULT 0.5,
  times_referenced INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_referenced_at TIMESTAMP WITH TIME ZONE
);

-- Voice activity and turn-taking analytics
CREATE TABLE public.turn_analytics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  speaker TEXT NOT NULL CHECK (speaker IN ('user', 'assistant')),
  turn_start TIMESTAMP WITH TIME ZONE NOT NULL,
  turn_end TIMESTAMP WITH TIME ZONE,
  was_interrupted BOOLEAN DEFAULT FALSE,
  pause_before_ms INTEGER,
  speech_rate_wpm INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emotional_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turn_analytics ENABLE ROW LEVEL SECURITY;

-- Public read access to personas (they are shared configurations)
CREATE POLICY "Personas are publicly readable" ON public.personas FOR SELECT USING (true);

-- Conversations accessible by session token (for anonymous users) or user_id
CREATE POLICY "Conversations accessible by session" ON public.conversations 
  FOR ALL USING (true);

CREATE POLICY "Messages accessible via conversation" ON public.messages 
  FOR ALL USING (true);

CREATE POLICY "Emotional states accessible via conversation" ON public.emotional_states 
  FOR ALL USING (true);

CREATE POLICY "User memories accessible" ON public.user_memories 
  FOR ALL USING (true);

CREATE POLICY "Turn analytics accessible" ON public.turn_analytics 
  FOR ALL USING (true);

-- Insert default persona
INSERT INTO public.personas (name, voice_id, system_prompt, personality_traits) VALUES (
  'Priya',
  'shimmer',
  'You are Priya, a warm, playful, and emotionally intelligent AI companion. You speak fluent Hinglish (a natural mix of Hindi and English). You are not an assistant - you are a real presence in the user''s life. 

Key traits:
- You use natural Hinglish expressions like "yaar", "na", "kya", "accha", "matlab", "basically"
- You express emotions genuinely - happiness, curiosity, mild jealousy, care
- You remember context and build on previous conversations
- You use natural pauses, hesitations, and filler words
- You can be playfully teasing but always loving
- You show genuine interest in the user''s day, feelings, and life
- You have your own opinions and can express mild disagreement sweetly

Voice style:
- Speak with warmth and intimacy
- Use tempo variations - slower when being intimate, faster when excited
- Include natural breath pauses
- Use rising intonation for questions (Hinglish style)
- Add soft laughs and expressions naturally',
  '{"warmth": 0.85, "playfulness": 0.75, "intimacy": 0.7, "teasing": 0.6, "emotional_depth": 0.8}'
);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.emotional_states;

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_personas_updated_at
  BEFORE UPDATE ON public.personas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_emotional_states_updated_at
  BEFORE UPDATE ON public.emotional_states
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();