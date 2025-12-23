export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      conversation_memories: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          emotion: string | null
          id: string
          importance: number
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          emotion?: string | null
          id?: string
          importance?: number
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          emotion?: string | null
          id?: string
          importance?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversation_memories_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ended_at: string | null
          id: string
          metadata: Json | null
          persona_id: string | null
          session_token: string | null
          started_at: string
          status: string
          total_duration_seconds: number | null
          user_id: string | null
        }
        Insert: {
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          persona_id?: string | null
          session_token?: string | null
          started_at?: string
          status?: string
          total_duration_seconds?: number | null
          user_id?: string | null
        }
        Update: {
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          persona_id?: string | null
          session_token?: string | null
          started_at?: string
          status?: string
          total_duration_seconds?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
        ]
      }
      emotional_states: {
        Row: {
          arousal: number
          attachment_level: number
          conversation_id: string
          current_emotion: string
          emotion_intensity: number
          familiarity_score: number
          id: string
          last_updated: string
          mood_valence: number
        }
        Insert: {
          arousal?: number
          attachment_level?: number
          conversation_id: string
          current_emotion?: string
          emotion_intensity?: number
          familiarity_score?: number
          id?: string
          last_updated?: string
          mood_valence?: number
        }
        Update: {
          arousal?: number
          attachment_level?: number
          conversation_id?: string
          current_emotion?: string
          emotion_intensity?: number
          familiarity_score?: number
          id?: string
          last_updated?: string
          mood_valence?: number
        }
        Relationships: [
          {
            foreignKeyName: "emotional_states_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          audio_url: string | null
          content: string
          conversation_id: string
          created_at: string
          detected_emotion: string | null
          duration_ms: number | null
          emotion_confidence: number | null
          id: string
          is_interruption: boolean | null
          role: string
          silence_before_ms: number | null
        }
        Insert: {
          audio_url?: string | null
          content: string
          conversation_id: string
          created_at?: string
          detected_emotion?: string | null
          duration_ms?: number | null
          emotion_confidence?: number | null
          id?: string
          is_interruption?: boolean | null
          role: string
          silence_before_ms?: number | null
        }
        Update: {
          audio_url?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          detected_emotion?: string | null
          duration_ms?: number | null
          emotion_confidence?: number | null
          id?: string
          is_interruption?: boolean | null
          role?: string
          silence_before_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          created_at: string
          id: string
          language_preference: string
          name: string
          personality_traits: Json
          system_prompt: string
          updated_at: string
          voice_id: string
          voice_settings: Json
        }
        Insert: {
          created_at?: string
          id?: string
          language_preference?: string
          name: string
          personality_traits?: Json
          system_prompt: string
          updated_at?: string
          voice_id?: string
          voice_settings?: Json
        }
        Update: {
          created_at?: string
          id?: string
          language_preference?: string
          name?: string
          personality_traits?: Json
          system_prompt?: string
          updated_at?: string
          voice_id?: string
          voice_settings?: Json
        }
        Relationships: []
      }
      turn_analytics: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          pause_before_ms: number | null
          speaker: string
          speech_rate_wpm: number | null
          turn_end: string | null
          turn_start: string
          was_interrupted: boolean | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          pause_before_ms?: number | null
          speaker: string
          speech_rate_wpm?: number | null
          turn_end?: string | null
          turn_start: string
          was_interrupted?: boolean | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          pause_before_ms?: number | null
          speaker?: string
          speech_rate_wpm?: number | null
          turn_end?: string | null
          turn_start?: string
          was_interrupted?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "turn_analytics_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_memories: {
        Row: {
          content: string
          created_at: string
          id: string
          importance_score: number
          last_referenced_at: string | null
          memory_type: string
          times_referenced: number | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          importance_score?: number
          last_referenced_at?: string | null
          memory_type: string
          times_referenced?: number | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          importance_score?: number
          last_referenced_at?: string | null
          memory_type?: string
          times_referenced?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
