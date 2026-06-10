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
      assigned_tasks: {
        Row: {
          assignee_user_id: string
          client_id: string
          created_at: string
          created_by_user_id: string
          deal_id: string | null
          department_group_id: string
          description: string | null
          id: string
          job_id: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          source_code: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_user_id: string
          client_id: string
          created_at?: string
          created_by_user_id: string
          deal_id?: string | null
          department_group_id: string
          description?: string | null
          id?: string
          job_id?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          source_code?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string
          client_id?: string
          created_at?: string
          created_by_user_id?: string
          deal_id?: string | null
          department_group_id?: string
          description?: string | null
          id?: string
          job_id?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          source_code?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assigned_tasks_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "assigned_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "assigned_tasks_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "assigned_tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_tasks_department_group_id_fkey"
            columns: ["department_group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assigned_tasks_resolved_by_user_id_fkey"
            columns: ["resolved_by_user_id"]
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
            foreignKeyName: "client_blocks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
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
          additional_contacts: Json
          address: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_owner_id: string | null
          city: string | null
          code: string | null
          contact_first_name: string | null
          contact_info: string | null
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
          start_date: string | null
          status: string
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          additional_contacts?: Json
          address?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_owner_id?: string | null
          city?: string | null
          code?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
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
          start_date?: string | null
          status?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          additional_contacts?: Json
          address?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_owner_id?: string | null
          city?: string | null
          code?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
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
          start_date?: string | null
          status?: string
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
          reply_to_id: string | null
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
          reply_to_id?: string | null
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
          reply_to_id?: string | null
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
          {
            foreignKeyName: "comments_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_payments: {
        Row: {
          amount: number
          amount_gross: number | null
          amount_net: number
          billing_type: string
          created_at: string
          deal_id: string
          end_date: string | null
          id: string
          invoice_number: string | null
          label: string | null
          paid_at: string | null
          service_index: number | null
          service_type: string | null
          start_date: string | null
          status: string
          updated_at: string
          vat_amount: number | null
          vat_rate: number
        }
        Insert: {
          amount?: number
          amount_gross?: number | null
          amount_net: number
          billing_type: string
          created_at?: string
          deal_id: string
          end_date?: string | null
          id?: string
          invoice_number?: string | null
          label?: string | null
          paid_at?: string | null
          service_index?: number | null
          service_type?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Update: {
          amount?: number
          amount_gross?: number | null
          amount_net?: number
          billing_type?: string
          created_at?: string
          deal_id?: string
          end_date?: string | null
          id?: string
          invoice_number?: string | null
          label?: string | null
          paid_at?: string | null
          service_index?: number | null
          service_type?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
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
          code: string | null
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
          payment_method: string | null
          probability: number | null
          recurring_monthly_value: number | null
          services_planned: Json
          stage_id: string
          title: string
          updated_at: string
          won_by_user_id: string | null
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
          code?: string | null
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
          payment_method?: string | null
          probability?: number | null
          recurring_monthly_value?: number | null
          services_planned?: Json
          stage_id: string
          title: string
          updated_at?: string
          won_by_user_id?: string | null
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
          code?: string | null
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
          payment_method?: string | null
          probability?: number | null
          recurring_monthly_value?: number | null
          services_planned?: Json
          stage_id?: string
          title?: string
          updated_at?: string
          won_by_user_id?: string | null
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
            foreignKeyName: "deals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
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
          {
            foreignKeyName: "deals_won_by_user_id_fkey"
            columns: ["won_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      email_automation_settings: {
        Row: {
          description: string
          enabled: boolean
          key: string
          updated_at: string
        }
        Insert: {
          description: string
          enabled?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          description?: string
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          created_at: string
          dedupe_key: string | null
          error: string | null
          id: string
          identity: string
          resend_id: string | null
          status: string
          template_key: string
          to_email: string
        }
        Insert: {
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          id?: string
          identity: string
          resend_id?: string | null
          status: string
          template_key: string
          to_email: string
        }
        Update: {
          created_at?: string
          dedupe_key?: string | null
          error?: string | null
          id?: string
          identity?: string
          resend_id?: string | null
          status?: string
          template_key?: string
          to_email?: string
        }
        Relationships: []
      }
      email_outbox: {
        Row: {
          attempts: number
          created_at: string
          data: Json
          dedupe_key: string | null
          id: string
          identity: string
          last_error: string | null
          sent_at: string | null
          status: string
          template_key: string
          to_email: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          identity: string
          last_error?: string | null
          sent_at?: string | null
          status?: string
          template_key: string
          to_email: string
        }
        Update: {
          attempts?: number
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          identity?: string
          last_error?: string | null
          sent_at?: string | null
          status?: string
          template_key?: string
          to_email?: string
        }
        Relationships: []
      }
      email_sequence_steps: {
        Row: {
          day_offset: number
          enabled: boolean
          id: string
          position: number
          sequence_id: string
          template_key: string
        }
        Insert: {
          day_offset: number
          enabled?: boolean
          id?: string
          position: number
          sequence_id: string
          template_key: string
        }
        Update: {
          day_offset?: number
          enabled?: boolean
          id?: string
          position?: number
          sequence_id?: string
          template_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sequence_steps_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["key"]
          },
        ]
      }
      email_sequences: {
        Row: {
          active_stage_codes: string[]
          description: string
          display_name: string
          enabled: boolean
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          active_stage_codes: string[]
          description: string
          display_name: string
          enabled?: boolean
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          active_stage_codes?: string[]
          description?: string
          display_name?: string
          enabled?: boolean
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body: string
          client_facing: boolean
          description: string
          key: string
          subject: string
          updated_at: string
          variables: string
        }
        Insert: {
          body: string
          client_facing?: boolean
          description: string
          key: string
          subject: string
          updated_at?: string
          variables?: string
        }
        Update: {
          body?: string
          client_facing?: boolean
          description?: string
          key?: string
          subject?: string
          updated_at?: string
          variables?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          key: string
          name_el: string
          name_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          key: string
          name_el: string
          name_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          key?: string
          name_el?: string
          name_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount_gross: number | null
          amount_net: number
          billing_type: string
          category_id: string
          created_at: string
          created_by: string | null
          end_date: string | null
          id: string
          notes: string | null
          paid_at: string | null
          paid_by: string | null
          parent_expense_id: string | null
          payment_method: string | null
          receipt_path: string | null
          start_date: string
          status: string
          updated_at: string
          vat_amount: number | null
          vat_rate: number
          vendor: string | null
        }
        Insert: {
          amount_gross?: number | null
          amount_net: number
          billing_type: string
          category_id: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          parent_expense_id?: string | null
          payment_method?: string | null
          receipt_path?: string | null
          start_date: string
          status?: string
          updated_at?: string
          vat_amount?: number | null
          vat_rate?: number
          vendor?: string | null
        }
        Update: {
          amount_gross?: number | null
          amount_net?: number
          billing_type?: string
          category_id?: string
          created_at?: string
          created_by?: string | null
          end_date?: string | null
          id?: string
          notes?: string | null
          paid_at?: string | null
          paid_by?: string | null
          parent_expense_id?: string | null
          payment_method?: string | null
          receipt_path?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          vat_amount?: number | null
          vat_rate?: number
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expenses_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "expenses_parent_expense_id_fkey"
            columns: ["parent_expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
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
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          client_id: string
          code: string | null
          completed_at: string | null
          created_at: string
          deal_id: string
          id: string
          is_blocked: boolean
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
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id: string
          code?: string | null
          completed_at?: string | null
          created_at?: string
          deal_id: string
          id?: string
          is_blocked?: boolean
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
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string
          code?: string | null
          completed_at?: string | null
          created_at?: string
          deal_id?: string
          id?: string
          is_blocked?: boolean
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
            foreignKeyName: "jobs_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
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
      lead_sequence_runs: {
        Row: {
          created_at: string
          id: string
          last_step_position: number
          lead_id: string
          sequence_id: string
          started_on: string
          stopped_at: string | null
          stopped_reason: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_step_position?: number
          lead_id: string
          sequence_id: string
          started_on?: string
          stopped_at?: string | null
          stopped_reason?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_step_position?: number
          lead_id?: string
          sequence_id?: string
          started_on?: string
          stopped_at?: string | null
          stopped_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_sequence_runs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_sequence_runs_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "email_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          additional_contacts: Json
          additional_notes: string | null
          address: string | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          automations_enabled: boolean
          code: string
          company_name: string | null
          contact_first_name: string | null
          contact_info: string | null
          contact_last_name: string | null
          converted_at: string | null
          converted_client_id: string | null
          converted_deal_id: string | null
          country: string | null
          created_at: string
          created_by: string | null
          email: string | null
          email_opt_out: boolean
          estimated_monthly_value: number
          estimated_one_time_value: number
          expected_close_date: string | null
          id: string
          industry: string | null
          notes: string | null
          owner_user_id: string | null
          payment_method: string | null
          phone: string | null
          scheduled_for: string | null
          services_planned: Json
          source: string
          source_data: Json | null
          stage_id: string | null
          title: string
          unsubscribe_token: string
          updated_at: string
          vat_number: string | null
          website: string | null
          won_by_user_id: string | null
        }
        Insert: {
          additional_contacts?: Json
          additional_notes?: string | null
          address?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean
          code?: string
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean
          estimated_monthly_value?: number
          estimated_one_time_value?: number
          expected_close_date?: string | null
          id?: string
          industry?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          scheduled_for?: string | null
          services_planned?: Json
          source: string
          source_data?: Json | null
          stage_id?: string | null
          title: string
          unsubscribe_token?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Update: {
          additional_contacts?: Json
          additional_notes?: string | null
          address?: string | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean
          code?: string
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean
          estimated_monthly_value?: number
          estimated_one_time_value?: number
          expected_close_date?: string | null
          id?: string
          industry?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          scheduled_for?: string | null
          services_planned?: Json
          source?: string
          source_data?: Json | null
          stage_id?: string | null
          title?: string
          unsubscribe_token?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_client_id_fkey"
            columns: ["converted_client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "leads_converted_deal_id_fkey"
            columns: ["converted_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leads_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_won_by_user_id_fkey"
            columns: ["won_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
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
      offers: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          deal_id: string | null
          discount_amount: number
          id: string
          items: Json
          lead_id: string | null
          notes: string | null
          offer_number: string | null
          pdf_path: string | null
          sent_at: string | null
          status: string
          totals: Json
          updated_at: string
          validity_days: number
          vat_percent: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id?: string | null
          discount_amount?: number
          id?: string
          items?: Json
          lead_id?: string | null
          notes?: string | null
          offer_number?: string | null
          pdf_path?: string | null
          sent_at?: string | null
          status?: string
          totals?: Json
          updated_at?: string
          validity_days?: number
          vat_percent?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id?: string | null
          discount_amount?: number
          id?: string
          items?: Json
          lead_id?: string | null
          notes?: string | null
          offer_number?: string | null
          pdf_path?: string | null
          sent_at?: string | null
          status?: string
          totals?: Json
          updated_at?: string
          validity_days?: number
          vat_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "offers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "offers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "offers_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offers_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
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
          job_title: string | null
          must_change_password: boolean
          offer_followup_days: number
          phone: string | null
          phone_extension: string | null
          preferred_locale: string
          timezone: string | null
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
          job_title?: string | null
          must_change_password?: boolean
          offer_followup_days?: number
          phone?: string | null
          phone_extension?: string | null
          preferred_locale?: string
          timezone?: string | null
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
          job_title?: string | null
          must_change_password?: boolean
          offer_followup_days?: number
          phone?: string | null
          phone_extension?: string | null
          preferred_locale?: string
          timezone?: string | null
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
      service_monthly_task_templates: {
        Row: {
          service_type: string
          tasks: Json
          updated_at: string
        }
        Insert: {
          service_type: string
          tasks?: Json
          updated_at?: string
        }
        Update: {
          service_type?: string
          tasks?: Json
          updated_at?: string
        }
        Relationships: []
      }
      service_packages: {
        Row: {
          archived: boolean
          code: string
          created_at: string
          default_monthly_amount: number | null
          default_one_time_amount: number | null
          description: string | null
          display_names: Json
          id: string
          is_active: boolean
          service_type: string
          setup_fee: number | null
          sort_order: number
          subtitle: string | null
          updated_at: string
        }
        Insert: {
          archived?: boolean
          code: string
          created_at?: string
          default_monthly_amount?: number | null
          default_one_time_amount?: number | null
          description?: string | null
          display_names: Json
          id?: string
          is_active?: boolean
          service_type: string
          setup_fee?: number | null
          sort_order?: number
          subtitle?: string | null
          updated_at?: string
        }
        Update: {
          archived?: boolean
          code?: string
          created_at?: string
          default_monthly_amount?: number | null
          default_one_time_amount?: number | null
          description?: string | null
          display_names?: Json
          id?: string
          is_active?: boolean
          service_type?: string
          setup_fee?: number | null
          sort_order?: number
          subtitle?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      service_subpackages: {
        Row: {
          archived: boolean
          code: string
          created_at: string
          description: string | null
          display_names: Json
          id: string
          is_active: boolean
          parent_package_id: string
          price: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          archived?: boolean
          code: string
          created_at?: string
          description?: string | null
          display_names: Json
          id?: string
          is_active?: boolean
          parent_package_id: string
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          archived?: boolean
          code?: string
          created_at?: string
          description?: string | null
          display_names?: Json
          id?: string
          is_active?: boolean
          parent_package_id?: string
          price?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_subpackages_parent_package_id_fkey"
            columns: ["parent_package_id"]
            isOneToOne: false
            referencedRelation: "service_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      user_google_accounts: {
        Row: {
          connected_at: string
          google_email: string
          refresh_token_enc: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          connected_at?: string
          google_email: string
          refresh_token_enc: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          connected_at?: string
          google_email?: string
          refresh_token_enc?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_google_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_groups: {
        Row: {
          created_at: string
          group_id: string
          is_team_lead: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          is_team_lead?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          is_team_lead?: boolean
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
      user_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          notes: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at: string
          id?: string
          notes?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          notes?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      accounting_ledger_v: {
        Row: {
          amount_gross: number | null
          amount_net: number | null
          billing_type: string | null
          category_key: string | null
          counterparty: string | null
          direction: string | null
          event_date: string | null
          period: string | null
          source_id: string | null
          source_table: string | null
          status: string | null
          vat_amount: number | null
        }
        Relationships: []
      }
      accounting_pl_summary_v: {
        Row: {
          net_profit_gross: number | null
          net_profit_net: number | null
          period: string | null
          total_expense_gross: number | null
          total_expense_net: number | null
          total_expense_vat: number | null
          total_income_gross: number | null
          total_income_net: number | null
          total_income_vat: number | null
        }
        Relationships: []
      }
      tech_my_clients: {
        Row: {
          active_jobs: number | null
          any_blocked: boolean | null
          client_id: string | null
          client_name: string | null
          client_status: string | null
          contact_first_name: string | null
          contact_last_name: string | null
          email: string | null
          industry: string | null
          last_activity: string | null
          service_type: string | null
        }
        Relationships: []
      }
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
      user_google_status: {
        Row: {
          connected: boolean | null
          google_email: string | null
          user_id: string | null
        }
        Insert: {
          connected?: never
          google_email?: string | null
          user_id?: string | null
        }
        Update: {
          connected?: never
          google_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_google_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Functions: {
      assignable_owners: {
        Args: never
        Returns: {
          email: string
          full_name: string
          is_admin: boolean
          user_id: string
        }[]
      }
      block_client: {
        Args: { reason_text: string; target_client_id: string }
        Returns: Json
      }
      block_job: {
        Args: { reason?: string; target_job_id: string }
        Returns: Json
      }
      complete_accounting: { Args: { target_deal_id: string }; Returns: Json }
      convert_lead_to_client: {
        Args: { target_lead_id: string }
        Returns: Json
      }
      current_user_can: {
        Args: { target_action: string; target_board: string }
        Returns: boolean
      }
      current_user_is_admin: { Args: never; Returns: boolean }
      current_user_scope: {
        Args: { target_action: string; target_board: string }
        Returns: string
      }
      email_automation_enabled: {
        Args: { setting_key: string }
        Returns: boolean
      }
      enqueue_lead_email: {
        Args: { dkey: string; target_lead_id: string; tpl_key: string }
        Returns: boolean
      }
      enqueue_payment_reminders: { Args: never; Returns: number }
      ensure_job_monthly_task_period: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      ensure_recurring_expenses: { Args: never; Returns: number }
      ensure_recurring_payments: { Args: never; Returns: number }
      generate_lead_code: { Args: never; Returns: string }
      global_search: {
        Args: { max_rows?: number; q: string }
        Returns: {
          code: string
          entity_id: string
          entity_type: string
          label: string
          rank: number
          sublabel: string
        }[]
      }
      is_client_blocked: {
        Args: { target_client_id: string }
        Returns: boolean
      }
      lead_email_payload: {
        Args: { l: Database["public"]["Tables"]["leads"]["Row"] }
        Returns: Json
      }
      lock_deal: { Args: { target_deal_id: string }; Returns: Json }
      mark_overdue_payments: { Args: never; Returns: number }
      mentionable_users: {
        Args: never
        Returns: {
          email: string
          full_name: string
          group_codes: string[]
          is_admin: boolean
          user_id: string
        }[]
      }
      move_overdue_deals_to_on_hold: { Args: never; Returns: number }
      my_google_status: {
        Args: never
        Returns: {
          connected: boolean
          google_email: string
        }[]
      }
      process_email_sequences: { Args: never; Returns: number }
      release_jobs_for_deal: {
        Args: { partial_payment_mode: boolean; target_deal_id: string }
        Returns: number
      }
      run_monthly_task_reset: { Args: never; Returns: undefined }
      seed_deal_payments: {
        Args: { target_deal_id: string }
        Returns: undefined
      }
      set_job_monthly_task: {
        Args: { p_code: string; p_completed: boolean; p_job_id: string }
        Returns: undefined
      }
      team_lead_for_group: { Args: { p_group_code: string }; Returns: string }
      unblock_client: { Args: { target_client_id: string }; Returns: Json }
      unblock_job: { Args: { target_job_id: string }; Returns: Json }
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
