export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          event_type: string
          id: string
          organization_id: string | null
          payload: Json
          project_id: string | null
          request_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: string
          organization_id?: string | null
          payload?: Json
          project_id?: string | null
          request_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: string
          organization_id?: string | null
          payload?: Json
          project_id?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["organization_role"]
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["organization_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["organization_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_memberships: {
        Row: {
          created_at: string
          invitation_id: string | null
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          scope: Database["public"]["Enums"]["project_scope"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invitation_id?: string | null
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          scope: Database["public"]["Enums"]["project_scope"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          invitation_id?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          scope?: Database["public"]["Enums"]["project_scope"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_memberships_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_at: string | null
          client_name: string | null
          created_at: string
          created_by: string
          custom_stage_name: string | null
          description: string | null
          due_date: string | null
          id: string
          last_activity_at: string
          name: string
          organization_id: string
          production_approach: Database["public"]["Enums"]["production_approach"]
          production_name: string | null
          stage_profile_id: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          client_name?: string | null
          created_at?: string
          created_by: string
          custom_stage_name?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          last_activity_at?: string
          name: string
          organization_id: string
          production_approach?: Database["public"]["Enums"]["production_approach"]
          production_name?: string | null
          stage_profile_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          client_name?: string | null
          created_at?: string
          created_by?: string
          custom_stage_name?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          last_activity_at?: string
          name?: string
          organization_id?: string
          production_approach?: Database["public"]["Enums"]["production_approach"]
          production_name?: string | null
          stage_profile_id?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_stage_profile_id_fkey"
            columns: ["stage_profile_id"]
            isOneToOne: false
            referencedRelation: "stage_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scenes: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          custom_stage_name_override: string | null
          id: string
          name: string
          production_approach_override:
            | Database["public"]["Enums"]["production_approach"]
            | null
          project_id: string
          rough_shot: Database["public"]["Enums"]["rough_shot_type"] | null
          scene_notes: string | null
          scene_number: number
          search_brief: string | null
          sort_order: number
          stage_profile_id_override: string | null
          structured_filters: Json
          updated_at: string
          vehicle: Database["public"]["Enums"]["vehicle_type"]
          version: number
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          custom_stage_name_override?: string | null
          id?: string
          name: string
          production_approach_override?:
            | Database["public"]["Enums"]["production_approach"]
            | null
          project_id: string
          rough_shot?: Database["public"]["Enums"]["rough_shot_type"] | null
          scene_notes?: string | null
          scene_number: number
          search_brief?: string | null
          sort_order?: number
          stage_profile_id_override?: string | null
          structured_filters?: Json
          updated_at?: string
          vehicle?: Database["public"]["Enums"]["vehicle_type"]
          version?: number
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          custom_stage_name_override?: string | null
          id?: string
          name?: string
          production_approach_override?:
            | Database["public"]["Enums"]["production_approach"]
            | null
          project_id?: string
          rough_shot?: Database["public"]["Enums"]["rough_shot_type"] | null
          scene_notes?: string | null
          scene_number?: number
          search_brief?: string | null
          sort_order?: number
          stage_profile_id_override?: string | null
          structured_filters?: Json
          updated_at?: string
          vehicle?: Database["public"]["Enums"]["vehicle_type"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scenes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenes_stage_profile_id_override_fkey"
            columns: ["stage_profile_id_override"]
            isOneToOne: false
            referencedRelation: "stage_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_users: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["staff_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["staff_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stage_profiles: {
        Row: {
          active: boolean
          capabilities: Json
          created_at: string
          dimensions: Json
          has_lab_replica: boolean
          id: string
          lab_replica_key: string | null
          location: string | null
          name: string
          stage_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          capabilities?: Json
          created_at?: string
          dimensions?: Json
          has_lab_replica?: boolean
          id?: string
          lab_replica_key?: string | null
          location?: string | null
          name: string
          stage_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          capabilities?: Json
          created_at?: string
          dimensions?: Json
          has_lab_replica?: boolean
          id?: string
          lab_replica_key?: string | null
          location?: string | null
          name?: string
          stage_type?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_project_scene: {
        Args: {
          scene_name: string
          search_brief?: string
          target_project_id: string
        }
        Returns: string
      }
      start_project: {
        Args: {
          client_name?: string
          display_name?: string
          first_scene_name: string
          organization_name: string
          production_name?: string
          project_name: string
          search_brief?: string
        }
        Returns: {
          project_id: string
          scene_id: string
        }[]
      }
    }
    Enums: {
      membership_status: "invited" | "active" | "suspended"
      organization_role: "owner" | "member"
      production_approach:
        | "listed_led_stage"
        | "custom_led_stage"
        | "undecided"
        | "vfx_no_led_wall"
      project_role: "owner" | "collaborator" | "reviewer"
      project_scope: "full_project" | "selected_clips_only"
      project_status: "active" | "archived"
      rough_shot_type:
        | "wide_front_left"
        | "wide_front_right"
        | "wide_rear"
        | "medium_front_left_three_quarter"
        | "medium_front_right_three_quarter"
        | "medium_rear_left_three_quarter"
        | "medium_rear_right_three_quarter"
        | "interior_over_shoulder"
        | "interior_passenger_to_driver"
        | "interior_driver_to_passenger"
        | "interior_side_window"
      staff_role: "producer" | "catalog_admin" | "system_admin"
      vehicle_type: "sports_car" | "sedan" | "suv" | "none" | "undecided"
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
    Enums: {
      membership_status: ["invited", "active", "suspended"],
      organization_role: ["owner", "member"],
      production_approach: [
        "listed_led_stage",
        "custom_led_stage",
        "undecided",
        "vfx_no_led_wall",
      ],
      project_role: ["owner", "collaborator", "reviewer"],
      project_scope: ["full_project", "selected_clips_only"],
      project_status: ["active", "archived"],
      rough_shot_type: [
        "wide_front_left",
        "wide_front_right",
        "wide_rear",
        "medium_front_left_three_quarter",
        "medium_front_right_three_quarter",
        "medium_rear_left_three_quarter",
        "medium_rear_right_three_quarter",
        "interior_over_shoulder",
        "interior_passenger_to_driver",
        "interior_driver_to_passenger",
        "interior_side_window",
      ],
      staff_role: ["producer", "catalog_admin", "system_admin"],
      vehicle_type: ["sports_car", "sedan", "suv", "none", "undecided"],
    },
  },
} as const
