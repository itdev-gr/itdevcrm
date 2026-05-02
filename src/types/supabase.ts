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
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          changes: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      attachments: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          kind: string | null
          mime_type: string | null
          parent_id: string
          parent_type: string
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          kind?: string | null
          mime_type?: string | null
          parent_id: string
          parent_type: string
          storage_path: string
          uploaded_by: string
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          kind?: string | null
          mime_type?: string | null
          parent_id?: string
          parent_type?: string
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      client_blocks: {
        Row: {
          blocked_at: string
          blocked_by: string | null
          client_id: string
          created_at: string
          id: string
          reason: string
          unblocked_at: string | null
          unblocked_by: string | null
        }
        Insert: {
          blocked_at?: string
          blocked_by?: string | null
          client_id: string
          created_at?: string
          id?: string
          reason: string
          unblocked_at?: string | null
          unblocked_by?: string | null
        }
        Update: {
          blocked_at?: string
          blocked_by?: string | null
          client_id?: string
          created_at?: string
          id?: string
          reason?: string
          unblocked_at?: string | null
          unblocked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_blocks_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "client_blocks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_blocks_unblocked_by_fkey"
            columns: ["unblocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_owner_id: string | null
          city: string | null
          contact_first_name: string | null
          contact_last_name: string | null
          country: string | null
          created_at: string
          email: string | null
          id: string
          industry: string | null
          lead_source: string | null
          name: string
          phone: string | null
          postcode: string | null
          region: string | null
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_owner_id?: string | null
          city?: string | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry?: string | null
          lead_source?: string | null
          name: string
          phone?: string | null
          postcode?: string | null
          region?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_owner_id?: string | null
          city?: string | null
          contact_first_name?: string | null
          contact_last_name?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry?: string | null
          lead_source?: string | null
          name?: string
          phone?: string | null
          postcode?: string | null
          region?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clients_assigned_owner_id_fkey"
            columns: ["assigned_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      comments: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          author_id: string
          body: string
          created_at: string
          id: string
          mentioned_user_ids: string[]
          parent_id: string
          parent_type: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          author_id: string
          body: string
          created_at?: string
          id?: string
          mentioned_user_ids?: string[]
          parent_id: string
          parent_type: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          mentioned_user_ids?: string[]
          parent_id?: string
          parent_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      deals: {
        Row: {
          accounting_completed_at: string | null
          accounting_completed_by: string | null
          accounting_stage_id: string | null
          actual_close_date: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          client_id: string
          created_at: string
          currency: string
          description: string | null
          expected_close_date: string | null
          id: string
          lead_source: string | null
          locked_at: string | null
          locked_by: string | null
          one_time_value: number | null
          owner_user_id: string | null
          probability: number | null
          recurring_monthly_value: number | null
          services_planned: Json
          stage_id: string
          title: string
          updated_at: string
        }
        Insert: {
          accounting_completed_at?: string | null
          accounting_completed_by?: string | null
          accounting_stage_id?: string | null
          actual_close_date?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          client_id: string
          created_at?: string
          currency?: string
          description?: string | null
          expected_close_date?: string | null
          id?: string
          lead_source?: string | null
          locked_at?: string | null
          locked_by?: string | null
          one_time_value?: number | null
          owner_user_id?: string | null
          probability?: number | null
          recurring_monthly_value?: number | null
          services_planned?: Json
          stage_id: string
          title: string
          updated_at?: string
        }
        Update: {
          accounting_completed_at?: string | null
          accounting_completed_by?: string | null
          accounting_stage_id?: string | null
          actual_close_date?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          client_id?: string
          created_at?: string
          currency?: string
          description?: string | null
          expected_close_date?: string | null
          id?: string
          lead_source?: string | null
          locked_at?: string | null
          locked_by?: string | null
          one_time_value?: number | null
          owner_user_id?: string | null
          probability?: number | null
          recurring_monthly_value?: number | null
          services_planned?: Json
          stage_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_accounting_completed_by_fkey"
            columns: ["accounting_completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "deals_accounting_stage_id_fkey"
            columns: ["accounting_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "deals_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      field_permissions: {
        Row: {
          created_at: string
          field_name: string
          id: string
          mode: string
          scope_id: string
          scope_type: string
          table_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          field_name: string
          id?: string
          mode: string
          scope_id: string
          scope_type: string
          table_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          field_name?: string
          id?: string
          mode?: string
          scope_id?: string
          scope_type?: string
          table_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      group_permissions: {
        Row: {
          action: string
          allowed: boolean
          board: string
          created_at: string
          group_id: string
          id: string
          scope: string
          updated_at: string
        }
        Insert: {
          action: string
          allowed?: boolean
          board: string
          created_at?: string
          group_id: string
          id?: string
          scope: string
          updated_at?: string
        }
        Update: {
          action?: string
          allowed?: boolean
          board?: string
          created_at?: string
          group_id?: string
          id?: string
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_permissions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          archived: boolean
          code: string
          created_at: string
          display_names: Json
          id: string
          parent_label: string | null
          position: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          code: string
          created_at?: string
          display_names: Json
          id?: string
          parent_label?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          code?: string
          created_at?: string
          display_names?: Json
          id?: string
          parent_label?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_group_id: string | null
          billing_type: string
          client_id: string
          completed_at: string | null
          created_at: string
          deal_id: string
          id: string
          monthly_amount: number | null
          monthly_tasks: Json
          monthly_tasks_period: string | null
          one_time_amount: number | null
          owner_user_id: string | null
          recurring_start_date: string | null
          service_type: string
          setup_fee: number | null
          stage_id: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_type: string
          client_id: string
          completed_at?: string | null
          created_at?: string
          deal_id: string
          id?: string
          monthly_amount?: number | null
          monthly_tasks?: Json
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          recurring_start_date?: string | null
          service_type: string
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_type?: string
          client_id?: string
          completed_at?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          monthly_amount?: number | null
          monthly_tasks?: Json
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          recurring_start_date?: string | null
          service_type?: string
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "jobs_assigned_group_id_fkey"
            columns: ["assigned_group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "jobs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_invoice_items: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          id: string
          invoice_id: string
          job_id: string | null
          service_type: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          id?: string
          invoice_id: string
          job_id?: string | null
          service_type?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          id?: string
          invoice_id?: string
          job_id?: string | null
          service_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "monthly_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_invoice_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_invoices: {
        Row: {
          amount_paid: number
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          client_id: string
          created_at: string
          due_date: string
          id: string
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          period: string
          status: string
          subtotal: number
          tax_amount: number | null
          tax_rate: number | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          client_id: string
          created_at?: string
          due_date: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          period: string
          status?: string
          subtotal?: number
          tax_amount?: number | null
          tax_rate?: number | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          client_id?: string
          created_at?: string
          due_date?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          period?: string
          status?: string
          subtotal?: number
          tax_amount?: number | null
          tax_rate?: number | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_invoices_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "monthly_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          payload: Json
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload: Json
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          archived: boolean
          board: string
          code: string
          color: string | null
          created_at: string
          display_names: Json
          id: string
          is_terminal: boolean
          position: number
          terminal_outcome: string | null
          triggers_action: string | null
          updated_at: string
        }
        Insert: {
          archived?: boolean
          board: string
          code: string
          color?: string | null
          created_at?: string
          display_names: Json
          id?: string
          is_terminal?: boolean
          position?: number
          terminal_outcome?: string | null
          triggers_action?: string | null
          updated_at?: string
        }
        Update: {
          archived?: boolean
          board?: string
          code?: string
          color?: string | null
          created_at?: string
          display_names?: Json
          id?: string
          is_terminal?: boolean
          position?: number
          terminal_outcome?: string | null
          triggers_action?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          is_active: boolean
          is_admin: boolean
          must_change_password: boolean
          preferred_locale: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string
          is_active?: boolean
          is_admin?: boolean
          must_change_password?: boolean
          preferred_locale?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          is_active?: boolean
          is_admin?: boolean
          must_change_password?: boolean
          preferred_locale?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      saved_filters: {
        Row: {
          board: string
          created_at: string
          filter_json: Json
          id: string
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          board: string
          created_at?: string
          filter_json: Json
          id?: string
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          board?: string
          created_at?: string
          filter_json?: Json
          id?: string
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_filters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_groups: {
        Row: {
          created_at: string
          group_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_groups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          action: string
          allowed: boolean
          board: string
          created_at: string
          id: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          allowed: boolean
          board: string
          created_at?: string
          id?: string
          scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          allowed?: boolean
          board?: string
          created_at?: string
          id?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      user_effective_permissions: {
        Row: {
          action: string | null
          allowed: boolean | null
          board: string | null
          scope: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      block_client: {
        Args: { reason_text: string; target_client_id: string }
        Returns: Json
      }
      complete_accounting: { Args: { target_deal_id: string }; Returns: Json }
      current_user_can: {
        Args: { target_action: string; target_board: string }
        Returns: boolean
      }
      current_user_is_admin: { Args: never; Returns: boolean }
      current_user_scope: {
        Args: { target_action: string; target_board: string }
        Returns: string
      }
      generate_monthly_invoices: {
        Args: { target_period: string }
        Returns: Json
      }
      is_client_blocked: {
        Args: { target_client_id: string }
        Returns: boolean
      }
      lock_deal: { Args: { target_deal_id: string }; Returns: Json }
      mark_overdue_invoices: { Args: never; Returns: number }
      unblock_client: { Args: { target_client_id: string }; Returns: Json }
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
