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
      ai_settings: {
        Row: {
          id: boolean
          model: string
          provider: string
          report_effort: string | null
          report_max_tokens: number
          report_system_prompt: string | null
          report_thinking: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          model?: string
          provider?: string
          report_effort?: string | null
          report_max_tokens?: number
          report_system_prompt?: string | null
          report_thinking?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          model?: string
          provider?: string
          report_effort?: string | null
          report_max_tokens?: number
          report_system_prompt?: string | null
          report_thinking?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boat_crew_people: {
        Row: {
          archived_at: string | null
          boat_id: string
          created_at: string
          created_by: string
          default_role: string | null
          display_name: string
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          boat_id: string
          created_at?: string
          created_by: string
          default_role?: string | null
          display_name: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          boat_id?: string
          created_at?: string
          created_by?: string
          default_role?: string | null
          display_name?: string
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boat_crew_people_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_crew_people_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boat_memberships: {
        Row: {
          boat_id: string
          created_at: string
          invited_by: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          boat_id: string
          created_at?: string
          invited_by: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          boat_id?: string
          created_at?: string
          invited_by?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boat_memberships_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boat_sails: {
        Row: {
          archived_at: string | null
          boat_id: string
          created_at: string
          created_by: string
          id: string
          label: string
          notes: string | null
          sail_type: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          boat_id: string
          created_at?: string
          created_by: string
          id?: string
          label: string
          notes?: string | null
          sail_type?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          boat_id?: string
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          notes?: string | null
          sail_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boat_sails_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_sails_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boat_session_tag_defs: {
        Row: {
          archived_at: string | null
          boat_id: string
          created_at: string
          created_by: string
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          boat_id: string
          created_at?: string
          created_by: string
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          boat_id?: string
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boat_session_tag_defs_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_session_tag_defs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boat_setups: {
        Row: {
          archived_at: string | null
          boat_id: string
          created_at: string
          created_by: string
          fields: Json
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          boat_id: string
          created_at?: string
          created_by: string
          fields?: Json
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          boat_id?: string
          created_at?: string
          created_by?: string
          fields?: Json
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boat_setups_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_setups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      boats: {
        Row: {
          boat_class: string | null
          claim_code: string | null
          claim_email: string | null
          created_at: string
          created_by: string
          id: string
          merged_at: string | null
          merged_by: string | null
          merged_into_id: string | null
          name: string
          owner_id: string | null
          sail_number: string | null
          updated_at: string
        }
        Insert: {
          boat_class?: string | null
          claim_code?: string | null
          claim_email?: string | null
          created_at?: string
          created_by: string
          id?: string
          merged_at?: string | null
          merged_by?: string | null
          merged_into_id?: string | null
          name: string
          owner_id?: string | null
          sail_number?: string | null
          updated_at?: string
        }
        Update: {
          boat_class?: string | null
          claim_code?: string | null
          claim_email?: string | null
          created_at?: string
          created_by?: string
          id?: string
          merged_at?: string | null
          merged_by?: string | null
          merged_into_id?: string | null
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
            foreignKeyName: "boats_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boats_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "boats"
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
      boat_merge_events: {
        Row: {
          affected_race_ids: string[]
          analyses_invalidated: number
          entries_moved: number
          id: string
          memberships_moved: number
          memberships_upgraded: number
          merged_at: string
          merged_by: string
          owner_inherited: boolean
          reports_invalidated: number
          source_boat_id: string
          summary: Json
          target_boat_id: string
        }
        Insert: {
          affected_race_ids?: string[]
          analyses_invalidated?: number
          entries_moved?: number
          id?: string
          memberships_moved?: number
          memberships_upgraded?: number
          merged_at?: string
          merged_by: string
          owner_inherited?: boolean
          reports_invalidated?: number
          source_boat_id: string
          summary?: Json
          target_boat_id: string
        }
        Update: {
          affected_race_ids?: string[]
          analyses_invalidated?: number
          entries_moved?: number
          id?: string
          memberships_moved?: number
          memberships_upgraded?: number
          merged_at?: string
          merged_by?: string
          owner_inherited?: boolean
          reports_invalidated?: number
          source_boat_id?: string
          summary?: Json
          target_boat_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "boat_merge_events_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_merge_events_source_boat_id_fkey"
            columns: ["source_boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_merge_events_target_boat_id_fkey"
            columns: ["target_boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
        ]
      }
      boat_session_observations: {
        Row: {
          boat_id: string
          created_at: string
          entry_id: string
          id: string
          metric_contract: string
          metric_version: string
          observation: Json
          occurred_at: string | null
          race_id: string
          session_type: string
          source_analysis_computed_at: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          boat_id: string
          created_at?: string
          entry_id: string
          id?: string
          metric_contract: string
          metric_version: string
          observation: Json
          occurred_at?: string | null
          race_id: string
          session_type: string
          source_analysis_computed_at?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          boat_id?: string
          created_at?: string
          entry_id?: string
          id?: string
          metric_contract?: string
          metric_version?: string
          observation?: Json
          occurred_at?: string | null
          race_id?: string
          session_type?: string
          source_analysis_computed_at?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boat_session_observations_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_session_observations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: true
            referencedRelation: "race_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boat_session_observations_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_events: {
        Row: {
          admin_user_id: string
          ended_at: string | null
          ended_reason: string | null
          expires_at: string
          id: string
          started_at: string
          started_ip: string | null
          target_user_id: string
          user_agent: string | null
        }
        Insert: {
          admin_user_id: string
          ended_at?: string | null
          ended_reason?: string | null
          expires_at: string
          id?: string
          started_at?: string
          started_ip?: string | null
          target_user_id: string
          user_agent?: string | null
        }
        Update: {
          admin_user_id?: string
          ended_at?: string | null
          ended_reason?: string | null
          expires_at?: string
          id?: string
          started_at?: string
          started_ip?: string | null
          target_user_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_events_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_events_target_user_id_fkey"
            columns: ["target_user_id"]
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
          corrections_applied_at: string | null
          race_id: string
          source_revision: number
          version: number
        }
        Insert: {
          analysis: Json
          computed_at?: string
          corrections_applied_at?: string | null
          race_id: string
          source_revision?: number
          version?: number
        }
        Update: {
          analysis?: Json
          computed_at?: string
          corrections_applied_at?: string | null
          race_id?: string
          source_revision?: number
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
      race_corrections: {
        Row: {
          corrections: Json
          race_id: string
          source_revision: number
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          corrections?: Json
          race_id: string
          source_revision?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          corrections?: Json
          race_id?: string
          source_revision?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "race_corrections_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: true
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_corrections_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      race_series: {
        Row: {
          archived_at: string | null
          created_at: string
          ends_on: string | null
          id: string
          name: string
          organizer_id: string
          revision: number
          scoring_config: Json
          scoring_version: string
          share_slug: string | null
          starts_on: string | null
          timezone: string | null
          updated_at: string
          venue: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          name: string
          organizer_id: string
          revision?: number
          scoring_config?: Json
          scoring_version?: string
          share_slug?: string | null
          starts_on?: string | null
          timezone?: string | null
          updated_at?: string
          venue?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          ends_on?: string | null
          id?: string
          name?: string
          organizer_id?: string
          revision?: number
          scoring_config?: Json
          scoring_version?: string
          share_slug?: string | null
          starts_on?: string | null
          timezone?: string | null
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "race_series_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      race_series_boat_aliases: {
        Row: {
          canonical_boat_id: string
          created_at: string
          note: string | null
          resolved_by: string
          series_id: string
          source_boat_id: string
          updated_at: string
        }
        Insert: {
          canonical_boat_id: string
          created_at?: string
          note?: string | null
          resolved_by: string
          series_id: string
          source_boat_id: string
          updated_at?: string
        }
        Update: {
          canonical_boat_id?: string
          created_at?: string
          note?: string | null
          resolved_by?: string
          series_id?: string
          source_boat_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_series_boat_aliases_canonical_fkey"
            columns: ["series_id", "canonical_boat_id"]
            isOneToOne: false
            referencedRelation: "race_series_competitors"
            referencedColumns: ["series_id", "boat_id"]
          },
          {
            foreignKeyName: "race_series_boat_aliases_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_series_boat_aliases_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "race_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_series_boat_aliases_source_boat_id_fkey"
            columns: ["source_boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
        ]
      }
      race_series_competitors: {
        Row: {
          boat_id: string
          created_at: string
          role: string
          series_id: string
          updated_at: string
        }
        Insert: {
          boat_id: string
          created_at?: string
          role?: string
          series_id: string
          updated_at?: string
        }
        Update: {
          boat_id?: string
          created_at?: string
          role?: string
          series_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_series_competitors_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_series_competitors_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "race_series"
            referencedColumns: ["id"]
          },
        ]
      }
      race_series_races: {
        Row: {
          created_at: string
          discard_eligible: boolean
          included: boolean
          official_results: Json
          official_results_revision: number
          official_results_updated_at: string | null
          official_results_updated_by: string | null
          race_id: string
          sequence: number
          series_id: string
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          discard_eligible?: boolean
          included?: boolean
          official_results?: Json
          official_results_revision?: number
          official_results_updated_at?: string | null
          official_results_updated_by?: string | null
          race_id: string
          sequence: number
          series_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          discard_eligible?: boolean
          included?: boolean
          official_results?: Json
          official_results_revision?: number
          official_results_updated_at?: string | null
          official_results_updated_by?: string | null
          race_id?: string
          sequence?: number
          series_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_series_races_official_results_updated_by_fkey"
            columns: ["official_results_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_series_races_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_series_races_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "race_series"
            referencedColumns: ["id"]
          },
        ]
      }
      race_series_score_snapshots: {
        Row: {
          computed_at: string
          computed_by: string
          id: string
          result: Json
          revision: number
          scoring_version: string
          series_id: string
          source_fingerprint: string
        }
        Insert: {
          computed_at?: string
          computed_by: string
          id?: string
          result: Json
          revision: number
          scoring_version: string
          series_id: string
          source_fingerprint: string
        }
        Update: {
          computed_at?: string
          computed_by?: string
          id?: string
          result?: Json
          revision?: number
          scoring_version?: string
          series_id?: string
          source_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_series_score_snapshots_computed_by_fkey"
            columns: ["computed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_series_score_snapshots_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "race_series"
            referencedColumns: ["id"]
          },
        ]
      }
      race_videos: {
        Row: {
          created_at: string
          duration_ms: number | null
          entry_id: string | null
          has_telemetry: boolean
          id: string
          last_error_code: string | null
          last_error_message: string | null
          original_filename: string
          processing_attempts: number
          processing_started_at: string | null
          race_id: string
          raw_path: string
          start_utc_ms: number | null
          status: string
          summary: Json | null
          timing_provenance: string | null
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          entry_id?: string | null
          has_telemetry?: boolean
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          original_filename: string
          processing_attempts?: number
          processing_started_at?: string | null
          race_id: string
          raw_path: string
          start_utc_ms?: number | null
          status?: string
          summary?: Json | null
          timing_provenance?: string | null
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          entry_id?: string | null
          has_telemetry?: boolean
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          original_filename?: string
          processing_attempts?: number
          processing_started_at?: string | null
          race_id?: string
          raw_path?: string
          start_utc_ms?: number | null
          status?: string
          summary?: Json | null
          timing_provenance?: string | null
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "race_videos_entry_race_fkey"
            columns: ["entry_id", "race_id"]
            isOneToOne: false
            referencedRelation: "race_entries"
            referencedColumns: ["id", "race_id"]
          },
          {
            foreignKeyName: "race_videos_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "race_videos_uploaded_by_fkey"
            columns: ["uploaded_by"]
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
          session_type: string
          share_slug: string | null
          starts_at: string
          starts_at_source: string
          tags: string[]
          timezone: string | null
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
          session_type?: string
          share_slug?: string | null
          starts_at: string
          starts_at_source?: string
          tags?: string[]
          timezone?: string | null
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
          session_type?: string
          share_slug?: string | null
          starts_at?: string
          starts_at_source?: string
          tags?: string[]
          timezone?: string | null
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
      session_metadata_snapshots: {
        Row: {
          boat_id: string
          created_at: string
          created_by: string
          entry_id: string
          id: string
          payload: Json
          race_id: string
          revision: number
        }
        Insert: {
          boat_id: string
          created_at?: string
          created_by: string
          entry_id: string
          id?: string
          payload: Json
          race_id: string
          revision: number
        }
        Update: {
          boat_id?: string
          created_at?: string
          created_by?: string
          entry_id?: string
          id?: string
          payload?: Json
          race_id?: string
          revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "session_metadata_snapshots_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_metadata_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_metadata_snapshots_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "race_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_metadata_snapshots_race_id_fkey"
            columns: ["race_id"]
            isOneToOne: false
            referencedRelation: "races"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_import_batches: {
        Row: {
          boat_id: string
          committed_at: string | null
          created_at: string
          created_by: string
          id: string
          last_error: string | null
          status: string
          updated_at: string
        }
        Insert: {
          boat_id: string
          committed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          last_error?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          boat_id?: string
          committed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          last_error?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_import_batches_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historical_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_import_items: {
        Row: {
          batch_id: string
          byte_size: number
          committed_track_id: string | null
          content_sha256: string | null
          created_at: string
          duplicate_track_id: string | null
          format: string | null
          id: string
          inspection: Json | null
          mapping: Json | null
          original_filename: string
          staging_path: string
          status: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          byte_size: number
          committed_track_id?: string | null
          content_sha256?: string | null
          created_at?: string
          duplicate_track_id?: string | null
          format?: string | null
          id?: string
          inspection?: Json | null
          mapping?: Json | null
          original_filename: string
          staging_path: string
          status?: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          byte_size?: number
          committed_track_id?: string | null
          content_sha256?: string | null
          created_at?: string
          duplicate_track_id?: string | null
          format?: string | null
          id?: string
          inspection?: Json | null
          mapping?: Json | null
          original_filename?: string
          staging_path?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "historical_import_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "historical_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
            tracks: {
        Row: {
          content_sha256: string | null
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
          source_import_item_id: string | null
          started_at: string | null
          status: string
          summary: Json | null
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          content_sha256?: string | null
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
          source_import_item_id?: string | null
          started_at?: string | null
          status?: string
          summary?: Json | null
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          content_sha256?: string | null
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
          source_import_item_id?: string | null
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
      accept_boat_owner_invitation: {
        Args: { invitation_code: string }
        Returns: {
          boat_id: string
          transferred: boolean
        }[]
      }
      apply_race_series_score_snapshot: {
        Args: {
          actor_id_input: string
          expected_revision_input: number
          race_updates_input: Json
          series_id_input: string
          snapshot_fingerprint_input: string
          snapshot_result_input: Json
          snapshot_scoring_version_input: string
        }
        Returns: {
          idempotent: boolean
          series_revision: number
          snapshot_id: string
          snapshot_revision: number
        }[]
      }
      can_edit_active_boat: { Args: { bid: string }; Returns: boolean }
      can_edit_boat: { Args: { bid: string }; Returns: boolean }
      can_manage_boat: { Args: { bid: string }; Returns: boolean }
      can_view_boat: { Args: { bid: string }; Returns: boolean }
      commit_historical_import_batch: {
        Args: { target_batch_id: string }
        Returns: {
          already_committed: boolean
          entry_id: string
          item_id: string
          race_id: string
          track_id: string
        }[]
      }
      get_historical_import_batch_for_editor: {
        Args: { target_batch_id: string }
        Returns: Json
      }
      create_practice_session: {
        Args: {
          boat_id_input: string
          name_input: string
          starts_at_input: string
          timezone_input: string
          venue_input?: string | null
        }
        Returns: {
          boat_id: string
          entry_id: string
          race_id: string
        }[]
      }
      create_race_entry_for_boat: {
        Args: {
          existing_boat_id?: string | null
          new_boat_name?: string | null
          target_race_id: string
        }
        Returns: {
          boat_id: string
          created_boat: boolean
          entry_id: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
      is_race_member: { Args: { rid: string }; Returns: boolean }
      is_race_organizer: { Args: { rid: string }; Returns: boolean }
      is_race_series_organizer: { Args: { sid: string }; Returns: boolean }
      join_race_with_boat: {
        Args: {
          existing_boat_id?: string | null
          join_code_input: string
          new_boat_class?: string | null
          new_boat_name?: string | null
          new_sail_number?: string | null
        }
        Returns: {
          boat_id: string
          created_boat: boolean
          entry_id: string
          race_id: string
        }[]
      }
      merge_boats: {
        Args: { p_source_boat_id: string; p_target_boat_id: string }
        Returns: Json
      }
      save_race_series_setup: {
        Args: {
          actor_id_input: string
          aliases_input: Json
          competitors_input: Json
          ends_on_input: string | null
          expected_revision_input: number
          name_input: string
          races_input: Json
          scoring_config_input: Json
          scoring_version_input: string
          series_id_input: string
          starts_on_input: string | null
          timezone_input: string
          venue_input: string
        }
        Returns: number
      }
      save_session_metadata_snapshot: {
        Args: { entry_id_input: string; payload_input: Json }
        Returns: string
      }
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
