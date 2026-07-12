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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      boats: {
        Row: {
          boat_class: string | null
          created_at: string
          created_by: string
          id: string
          name: string
          owner_id: string | null
          sail_number: string | null
          updated_at: string
        }
        Insert: {
          boat_class?: string | null
          created_at?: string
          created_by: string
          id?: string
          name: string
          owner_id?: string | null
          sail_number?: string | null
          updated_at?: string
        }
        Update: {
          boat_class?: string | null
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          owner_id?: string | null
          sail_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boats_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boats_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          is_admin: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          is_admin?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          is_admin?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      race_analyses: {
        Row: {
          analysis: Json
          computed_at: string
          race_id: string
          version: number
        }
        Insert: {
          analysis: Json
          computed_at?: string
          race_id: string
          version?: number
        }
        Update: {
          analysis?: Json
          computed_at?: string
          race_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_analyses_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: true
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_entries: {
        Row: {
          added_by: string
          boat_id: string
          color: string
          created_at: string
          crew: Json
          id: string
          race_id: string
          tags: string[]
        }
        Insert: {
          added_by: string
          boat_id: string
          color?: string
          created_at?: string
          crew?: Json
          id?: string
          race_id: string
          tags?: string[]
        }
        Update: {
          added_by?: string
          boat_id?: string
          color?: string
          created_at?: string
          crew?: Json
          id?: string
          race_id?: string
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "race_entries_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_entries_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_entries_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      race_reports: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          input_tokens: number | null
          markdown: string | null
          model: string | null
          output_tokens: number | null
          race_id: string
          requested_by: string
          stats_payload: Json | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_tokens?: number | null
          markdown?: string | null
          model?: string | null
          output_tokens?: number | null
          race_id: string
          requested_by: string
          stats_payload?: Json | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          input_tokens?: number | null
          markdown?: string | null
          model?: string | null
          output_tokens?: number | null
          race_id?: string
          requested_by?: string
          stats_payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_reports_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_reports_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      races: {
        Row: {
          conditions: Json | null
          created_at: string
          id: string
          join_code: string
          name: string
          organizer_id: string
          share_slug: string | null
          starts_at: string | null
          tags: string[]
          updated_at: string
          venue: string | null
        }
        Insert: {
          conditions?: Json | null
          created_at?: string
          id?: string
          join_code?: string
          name: string
          organizer_id: string
          share_slug?: string | null
          starts_at?: string | null
          tags?: string[]
          updated_at?: string
          venue?: string | null
        }
        Update: {
          conditions?: Json | null
          created_at?: string
          id?: string
          join_code?: string
          name?: string
          organizer_id?: string
          share_slug?: string | null
          starts_at?: string | null
          tags?: string[]
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "races_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          created_at: string
          ended_at: string | null
          entry_id: string
          error_message: string | null
          format: string
          id: string
          original_filename: string
          point_count: number | null
          processed_path: string | null
          raw_path: string
          started_at: string | null
          status: string
          summary: Json | null
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          entry_id: string
          error_message?: string | null
          format: string
          id?: string
          original_filename: string
          point_count?: number | null
          processed_path?: string | null
          raw_path: string
          started_at?: string | null
          status?: string
          summary?: Json | null
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          entry_id?: string
          error_message?: string | null
          format?: string
          id?: string
          original_filename?: string
          point_count?: number | null
          processed_path?: string | null
          raw_path?: string
          started_at?: string | null
          status?: string
          summary?: Json | null
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracks_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "race_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_admin: { Args: never; Returns: boolean }
      is_race_member: { Args: { rid: string }; Returns: boolean }
      is_race_organizer: { Args: { rid: string }; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
