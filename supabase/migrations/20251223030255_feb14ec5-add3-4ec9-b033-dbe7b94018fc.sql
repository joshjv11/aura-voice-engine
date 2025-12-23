-- Create conversation memories table for semantic memory storage
CREATE TABLE IF NOT EXISTS public.conversation_memories (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 3,
    emotion TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for fast retrieval by conversation
CREATE INDEX IF NOT EXISTS idx_conversation_memories_conv ON public.conversation_memories(conversation_id);

-- Enable RLS
ALTER TABLE public.conversation_memories ENABLE ROW LEVEL SECURITY;

-- Public read/write for now (no auth in use yet)
CREATE POLICY "Allow all operations on conversation_memories"
ON public.conversation_memories
FOR ALL
USING (true)
WITH CHECK (true);