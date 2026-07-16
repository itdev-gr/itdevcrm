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
          client_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          client_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          client_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      activity_log_clientid_backfill_backup_20260625: {
        Row: {
          client_id: string | null
          id: string | null
        }
        Insert: {
          client_id?: string | null
          id?: string | null
        }
        Update: {
          client_id?: string | null
          id?: string | null
        }
        Relationships: []
      }
      activity_log_email_dedup_backup_20260629: {
        Row: {
          action: string | null
          changes: Json | null
          client_id: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          changes?: Json | null
          client_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          changes?: Json | null
          client_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      activity_log_noop_backup_20260629: {
        Row: {
          action: string | null
          changes: Json | null
          client_id: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          changes?: Json | null
          client_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          changes?: Json | null
          client_id?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      announcement_dismissals: {
        Row: {
          announcement_id: string
          dismissed_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          dismissed_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          dismissed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_dismissals_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      announcement_targets: {
        Row: {
          announcement_id: string
          group_id: string
        }
        Insert: {
          announcement_id: string
          group_id: string
        }
        Update: {
          announcement_id?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_targets_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_targets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          severity: string
          target_all: boolean
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          severity?: string
          target_all?: boolean
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          severity?: string
          target_all?: boolean
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
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
          importance: string
          job_id: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          source_code: string | null
          started_at: string | null
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
          importance?: string
          job_id?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          source_code?: string | null
          started_at?: string | null
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
          importance?: string
          job_id?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          source_code?: string | null
          started_at?: string | null
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
      block_lifecycle_backup_20260626: {
        Row: {
          accounting_stage_id: string | null
          backed_up_at: string | null
          client_id: string | null
          deal_id: string | null
        }
        Insert: {
          accounting_stage_id?: string | null
          backed_up_at?: string | null
          client_id?: string | null
          deal_id?: string | null
        }
        Update: {
          accounting_stage_id?: string | null
          backed_up_at?: string | null
          client_id?: string | null
          deal_id?: string | null
        }
        Relationships: []
      }
      block_lifecycle_clients_backup_20260626: {
        Row: {
          backed_up_at: string | null
          client_id: string | null
          status: string | null
        }
        Insert: {
          backed_up_at?: string | null
          client_id?: string | null
          status?: string | null
        }
        Update: {
          backed_up_at?: string | null
          client_id?: string | null
          status?: string | null
        }
        Relationships: []
      }
      block_lifecycle_jobs_backup_20260626: {
        Row: {
          backed_up_at: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          deal_id: string | null
          is_blocked: boolean | null
          job_id: string | null
          stage_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          deal_id?: string | null
          is_blocked?: boolean | null
          job_id?: string | null
          stage_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          deal_id?: string | null
          is_blocked?: boolean | null
          job_id?: string | null
          stage_id?: string | null
        }
        Relationships: []
      }
      business_profile_ai_backfill_backup_20260714: {
        Row: {
          deal_id: string | null
          job_id: string | null
          job_name_before: string | null
          job_url_before: string | null
          status: string | null
        }
        Insert: {
          deal_id?: string | null
          job_id?: string | null
          job_name_before?: string | null
          job_url_before?: string | null
          status?: string | null
        }
        Update: {
          deal_id?: string | null
          job_id?: string | null
          job_name_before?: string | null
          job_url_before?: string | null
          status?: string | null
        }
        Relationships: []
      }
      business_profile_backfill_backup_20260714: {
        Row: {
          deal_id: string | null
          deal_name_before: string | null
          deal_url_before: string | null
          job_id: string | null
          job_name_before: string | null
          job_url_before: string | null
          status: string | null
        }
        Insert: {
          deal_id?: string | null
          deal_name_before?: string | null
          deal_url_before?: string | null
          job_id?: string | null
          job_name_before?: string | null
          job_url_before?: string | null
          status?: string | null
        }
        Update: {
          deal_id?: string | null
          deal_name_before?: string | null
          deal_url_before?: string | null
          job_id?: string | null
          job_name_before?: string | null
          job_url_before?: string | null
          status?: string | null
        }
        Relationships: []
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
          phone_normalized: string | null
          postcode: string | null
          region: string | null
          source_data: Json | null
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
          phone_normalized?: string | null
          postcode?: string | null
          region?: string | null
          source_data?: Json | null
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
          phone_normalized?: string | null
          postcode?: string | null
          region?: string | null
          source_data?: Json | null
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
      clients_rebaseline_status_backup_20260619: {
        Row: {
          id: string | null
          status: string | null
        }
        Insert: {
          id?: string | null
          status?: string | null
        }
        Update: {
          id?: string | null
          status?: string | null
        }
        Relationships: []
      }
      comment_thread_reads: {
        Row: {
          last_seen_at: string
          parent_id: string
          parent_type: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          parent_id: string
          parent_type: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          parent_id?: string
          parent_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_thread_reads_user_id_fkey"
            columns: ["user_id"]
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
          task_key: string | null
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
          task_key?: string | null
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
          task_key?: string | null
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
      comments_aiseo_del_backup_20260625: {
        Row: {
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          author_id: string | null
          body: string | null
          created_at: string | null
          id: string | null
          mentioned_user_ids: string[] | null
          parent_id: string | null
          parent_type: string | null
          reply_to_id: string | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          author_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string | null
          mentioned_user_ids?: string[] | null
          parent_id?: string | null
          parent_type?: string | null
          reply_to_id?: string | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          author_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string | null
          mentioned_user_ids?: string[] | null
          parent_id?: string | null
          parent_type?: string | null
          reply_to_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      comments_aiseo_dup_backup_20260625: {
        Row: {
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          author_id: string | null
          body: string | null
          created_at: string | null
          id: string | null
          mentioned_user_ids: string[] | null
          parent_id: string | null
          parent_type: string | null
          reply_to_id: string | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          author_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string | null
          mentioned_user_ids?: string[] | null
          parent_id?: string | null
          parent_type?: string | null
          reply_to_id?: string | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          author_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string | null
          mentioned_user_ids?: string[] | null
          parent_id?: string | null
          parent_type?: string | null
          reply_to_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      comments_dup_won_delete_backup_20260623: {
        Row: {
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          author_id: string | null
          body: string | null
          created_at: string | null
          id: string | null
          mentioned_user_ids: string[] | null
          parent_id: string | null
          parent_type: string | null
          reply_to_id: string | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          author_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string | null
          mentioned_user_ids?: string[] | null
          parent_id?: string | null
          parent_type?: string | null
          reply_to_id?: string | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          author_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string | null
          mentioned_user_ids?: string[] | null
          parent_id?: string | null
          parent_type?: string | null
          reply_to_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      comments_reparent_backup_20260709: {
        Row: {
          id: string | null
          parent_id: string | null
          parent_type: string | null
        }
        Insert: {
          id?: string | null
          parent_id?: string | null
          parent_type?: string | null
        }
        Update: {
          id?: string | null
          parent_id?: string | null
          parent_type?: string | null
        }
        Relationships: []
      }
      contact_backfill_backup_20260630: {
        Row: {
          backed_up_at: string
          new_email: string | null
          new_phone: string | null
          prev_email: string | null
          prev_phone: string | null
          prev_phone_normalized: string | null
          row_id: string
          src_table: string
        }
        Insert: {
          backed_up_at?: string
          new_email?: string | null
          new_phone?: string | null
          prev_email?: string | null
          prev_phone?: string | null
          prev_phone_normalized?: string | null
          row_id: string
          src_table: string
        }
        Update: {
          backed_up_at?: string
          new_email?: string | null
          new_phone?: string | null
          prev_email?: string | null
          prev_phone?: string | null
          prev_phone_normalized?: string | null
          row_id?: string
          src_table?: string
        }
        Relationships: []
      }
      contract_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          body: string
          client_id: string
          contract_number: string | null
          created_at: string
          created_by: string | null
          id: string
          pdf_path: string | null
          sent_at: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          client_id: string
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pdf_path?: string | null
          sent_at?: string | null
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          client_id?: string
          contract_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          pdf_path?: string | null
          sent_at?: string | null
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "contracts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "contract_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      data_integrity_alerts: {
        Row: {
          details: Json
          detected_at: string
          id: string
          kind: string
          resolved_at: string | null
          resolved_by: string | null
          subject_id: string
          subject_type: string
        }
        Insert: {
          details?: Json
          detected_at?: string
          id?: string
          kind: string
          resolved_at?: string | null
          resolved_by?: string | null
          subject_id: string
          subject_type: string
        }
        Update: {
          details?: Json
          detected_at?: string
          id?: string
          kind?: string
          resolved_at?: string | null
          resolved_by?: string | null
          subject_id?: string
          subject_type?: string
        }
        Relationships: []
      }
      deal_payment_lines: {
        Row: {
          amount_gross: number | null
          amount_net: number
          created_at: string
          id: string
          job_id: string | null
          label: string | null
          payment_id: string
          vat_amount: number | null
          vat_rate: number
        }
        Insert: {
          amount_gross?: number | null
          amount_net?: number
          created_at?: string
          id?: string
          job_id?: string | null
          label?: string | null
          payment_id: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Update: {
          amount_gross?: number | null
          amount_net?: number
          created_at?: string
          id?: string
          job_id?: string | null
          label?: string | null
          payment_id?: string
          vat_amount?: number | null
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "deal_payment_lines_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_payment_lines_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "deal_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_payment_lines_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "deal_payments_with_totals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_payment_lines_aiseo_dup_backup_20260625: {
        Row: {
          amount_gross: number | null
          amount_net: number | null
          created_at: string | null
          id: string | null
          job_id: string | null
          label: string | null
          payment_id: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      deal_payment_lines_backup_20260619: {
        Row: {
          amount_gross: number | null
          amount_net: number | null
          created_at: string | null
          id: string | null
          job_id: string | null
          label: string | null
          payment_id: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      deal_payment_lines_backup_20260714: {
        Row: {
          amount_gross: number | null
          amount_net: number | null
          created_at: string | null
          id: string | null
          job_id: string | null
          label: string | null
          payment_id: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      deal_payment_lines_full_backup_20260619: {
        Row: {
          amount_gross: number | null
          amount_net: number | null
          created_at: string | null
          id: string | null
          job_id: string | null
          label: string | null
          payment_id: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: []
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
      deal_payments_aiseo_dup_backup_20260625: {
        Row: {
          amount: number | null
          amount_gross: number | null
          amount_net: number | null
          billing_type: string | null
          created_at: string | null
          deal_id: string | null
          end_date: string | null
          id: string | null
          invoice_number: string | null
          label: string | null
          paid_at: string | null
          service_index: number | null
          service_type: string | null
          start_date: string | null
          status: string | null
          updated_at: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          amount?: number | null
          amount_gross?: number | null
          amount_net?: number | null
          billing_type?: string | null
          created_at?: string | null
          deal_id?: string | null
          end_date?: string | null
          id?: string | null
          invoice_number?: string | null
          label?: string | null
          paid_at?: string | null
          service_index?: number | null
          service_type?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          amount?: number | null
          amount_gross?: number | null
          amount_net?: number | null
          billing_type?: string | null
          created_at?: string | null
          deal_id?: string | null
          end_date?: string | null
          id?: string | null
          invoice_number?: string | null
          label?: string | null
          paid_at?: string | null
          service_index?: number | null
          service_type?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      deal_payments_backup_20260619: {
        Row: {
          amount: number | null
          amount_gross: number | null
          amount_net: number | null
          billing_type: string | null
          created_at: string | null
          deal_id: string | null
          end_date: string | null
          id: string | null
          invoice_number: string | null
          label: string | null
          paid_at: string | null
          service_index: number | null
          service_type: string | null
          start_date: string | null
          status: string | null
          updated_at: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          amount?: number | null
          amount_gross?: number | null
          amount_net?: number | null
          billing_type?: string | null
          created_at?: string | null
          deal_id?: string | null
          end_date?: string | null
          id?: string | null
          invoice_number?: string | null
          label?: string | null
          paid_at?: string | null
          service_index?: number | null
          service_type?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          amount?: number | null
          amount_gross?: number | null
          amount_net?: number | null
          billing_type?: string | null
          created_at?: string | null
          deal_id?: string | null
          end_date?: string | null
          id?: string | null
          invoice_number?: string | null
          label?: string | null
          paid_at?: string | null
          service_index?: number | null
          service_type?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      deal_payments_flipflop_backup_20260701: {
        Row: {
          amount: number | null
          amount_net: number | null
          billing_type: string | null
          created_at: string | null
          deal_id: string | null
          end_date: string | null
          id: string | null
          invoice_number: string | null
          label: string | null
          paid_at: string | null
          service_index: number | null
          service_type: string | null
          start_date: string | null
          status: string | null
          updated_at: string | null
          vat_rate: number | null
        }
        Insert: {
          amount?: number | null
          amount_net?: number | null
          billing_type?: string | null
          created_at?: string | null
          deal_id?: string | null
          end_date?: string | null
          id?: string | null
          invoice_number?: string | null
          label?: string | null
          paid_at?: string | null
          service_index?: number | null
          service_type?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          amount?: number | null
          amount_net?: number | null
          billing_type?: string | null
          created_at?: string | null
          deal_id?: string | null
          end_date?: string | null
          id?: string | null
          invoice_number?: string | null
          label?: string | null
          paid_at?: string | null
          service_index?: number | null
          service_type?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      deal_payments_hosting_yearly_20260622: {
        Row: {
          backed_up_at: string | null
          id: string | null
          old_billing_type: string | null
          old_end_date: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          old_billing_type?: string | null
          old_end_date?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          old_billing_type?: string | null
          old_end_date?: string | null
        }
        Relationships: []
      }
      deal_payments_overdue_backfill_backup_20260628: {
        Row: {
          backed_up_at: string | null
          billing_type: string | null
          deal_id: string | null
          end_date: string | null
          id: string | null
          start_date: string | null
          status: string | null
        }
        Insert: {
          backed_up_at?: string | null
          billing_type?: string | null
          deal_id?: string | null
          end_date?: string | null
          id?: string | null
          start_date?: string | null
          status?: string | null
        }
        Update: {
          backed_up_at?: string | null
          billing_type?: string | null
          deal_id?: string | null
          end_date?: string | null
          id?: string | null
          start_date?: string | null
          status?: string | null
        }
        Relationships: []
      }
      deal_payments_service_backfill_20260622: {
        Row: {
          backed_up_at: string | null
          id: string | null
          new_service_type: string | null
          old_service_type: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          new_service_type?: string | null
          old_service_type?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          new_service_type?: string | null
          old_service_type?: string | null
        }
        Relationships: []
      }
      deal_payments_service_fix_20260622: {
        Row: {
          backed_up_at: string | null
          id: string | null
          new_service_type: string | null
          old_service_type: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          new_service_type?: string | null
          old_service_type?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          new_service_type?: string | null
          old_service_type?: string | null
        }
        Relationships: []
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
          business_profile_name: string | null
          business_profile_url: string | null
          cash_charge_vat: boolean
          client_id: string
          code: string | null
          created_at: string
          currency: string
          description: string | null
          expected_close_date: string | null
          id: string
          invoiced_date: string | null
          lead_source: string | null
          locked_at: string | null
          locked_by: string | null
          one_time_value: number | null
          owner_user_id: string | null
          payment_method: string | null
          probability: number | null
          recurring_monthly_value: number | null
          sales_note: string | null
          services_planned: Json
          source_data: Json | null
          stage_id: string
          suppress_payment_reminders: boolean
          temp_deal_amount: string | null
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
          business_profile_name?: string | null
          business_profile_url?: string | null
          cash_charge_vat?: boolean
          client_id: string
          code?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          expected_close_date?: string | null
          id?: string
          invoiced_date?: string | null
          lead_source?: string | null
          locked_at?: string | null
          locked_by?: string | null
          one_time_value?: number | null
          owner_user_id?: string | null
          payment_method?: string | null
          probability?: number | null
          recurring_monthly_value?: number | null
          sales_note?: string | null
          services_planned?: Json
          source_data?: Json | null
          stage_id: string
          suppress_payment_reminders?: boolean
          temp_deal_amount?: string | null
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
          business_profile_name?: string | null
          business_profile_url?: string | null
          cash_charge_vat?: boolean
          client_id?: string
          code?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          expected_close_date?: string | null
          id?: string
          invoiced_date?: string | null
          lead_source?: string | null
          locked_at?: string | null
          locked_by?: string | null
          one_time_value?: number | null
          owner_user_id?: string | null
          payment_method?: string | null
          probability?: number | null
          recurring_monthly_value?: number | null
          sales_note?: string | null
          services_planned?: Json
          source_data?: Json | null
          stage_id?: string
          suppress_payment_reminders?: boolean
          temp_deal_amount?: string | null
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
      deals_block_resweep_backup_20260623: {
        Row: {
          backed_up_at: string | null
          deal_id: string | null
          stage_before: string | null
        }
        Insert: {
          backed_up_at?: string | null
          deal_id?: string | null
          stage_before?: string | null
        }
        Update: {
          backed_up_at?: string | null
          deal_id?: string | null
          stage_before?: string | null
        }
        Relationships: []
      }
      deals_done_unarchive_backup_20260622: {
        Row: {
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          backed_up_at: string | null
          id: string | null
        }
        Insert: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          backed_up_at?: string | null
          id?: string | null
        }
        Update: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          backed_up_at?: string | null
          id?: string | null
        }
        Relationships: []
      }
      deals_onhold_sweep_backup_20260623: {
        Row: {
          backed_up_at: string | null
          deal_id: string | null
          prev_stage_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          deal_id?: string | null
          prev_stage_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          deal_id?: string | null
          prev_stage_id?: string | null
        }
        Relationships: []
      }
      deals_rebaseline_backup_20260619: {
        Row: {
          accounting_completed_at: string | null
          accounting_completed_by: string | null
          accounting_stage_id: string | null
          actual_close_date: string | null
          code: string | null
          id: string | null
          invoiced_date: string | null
          payment_method: string | null
        }
        Insert: {
          accounting_completed_at?: string | null
          accounting_completed_by?: string | null
          accounting_stage_id?: string | null
          actual_close_date?: string | null
          code?: string | null
          id?: string | null
          invoiced_date?: string | null
          payment_method?: string | null
        }
        Update: {
          accounting_completed_at?: string | null
          accounting_completed_by?: string | null
          accounting_stage_id?: string | null
          actual_close_date?: string | null
          code?: string | null
          id?: string | null
          invoiced_date?: string | null
          payment_method?: string | null
        }
        Relationships: []
      }
      deals_test_delete_backup_20260714: {
        Row: {
          row: Json
          tbl: string
        }
        Insert: {
          row: Json
          tbl: string
        }
        Update: {
          row?: Json
          tbl?: string
        }
        Relationships: []
      }
      deleted_test_clients_backup_20260622: {
        Row: {
          data: Json | null
          deleted_at: string | null
          entity: string | null
          id: string | null
        }
        Insert: {
          data?: Json | null
          deleted_at?: string | null
          entity?: string | null
          id?: string | null
        }
        Update: {
          data?: Json | null
          deleted_at?: string | null
          entity?: string | null
          id?: string | null
        }
        Relationships: []
      }
      dpl_aiseo_del_backup_20260625: {
        Row: {
          amount_gross: number | null
          amount_net: number | null
          created_at: string | null
          id: string | null
          job_id: string | null
          label: string | null
          payment_id: string | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          amount_gross?: number | null
          amount_net?: number | null
          created_at?: string | null
          id?: string | null
          job_id?: string | null
          label?: string | null
          payment_id?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: []
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
      email_dept_mkif_retag_backup_20260710: {
        Row: {
          department: string | null
          id: string
        }
        Insert: {
          department?: string | null
          id: string
        }
        Update: {
          department?: string | null
          id?: string
        }
        Relationships: []
      }
      email_drain_heartbeat: {
        Row: {
          failed: number
          id: boolean
          last_ok_at: string | null
          last_run_at: string | null
          processed: number
          sent: number
          updated_at: string
        }
        Insert: {
          failed?: number
          id?: boolean
          last_ok_at?: string | null
          last_run_at?: string | null
          processed?: number
          sent?: number
          updated_at?: string
        }
        Update: {
          failed?: number
          id?: boolean
          last_ok_at?: string | null
          last_run_at?: string | null
          processed?: number
          sent?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          bounced_at: string | null
          client_id: string | null
          created_at: string
          dedupe_key: string | null
          delivered_at: string | null
          error: string | null
          id: string
          identity: string
          resend_id: string | null
          status: string
          template_key: string
          to_email: string
        }
        Insert: {
          bounced_at?: string | null
          client_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          error?: string | null
          id?: string
          identity: string
          resend_id?: string | null
          status: string
          template_key: string
          to_email: string
        }
        Update: {
          bounced_at?: string | null
          client_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          error?: string | null
          id?: string
          identity?: string
          resend_id?: string | null
          status?: string
          template_key?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
        ]
      }
      email_log_clientid_backup_20260625: {
        Row: {
          client_id: string | null
          id: string | null
        }
        Insert: {
          client_id?: string | null
          id?: string | null
        }
        Update: {
          client_id?: string | null
          id?: string | null
        }
        Relationships: []
      }
      email_message_bcc: {
        Row: {
          bcc_emails: string
          created_at: string
          message_pk: string
        }
        Insert: {
          bcc_emails: string
          created_at?: string
          message_pk: string
        }
        Update: {
          bcc_emails?: string
          created_at?: string
          message_pk?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_message_bcc_message_pk_fkey"
            columns: ["message_pk"]
            isOneToOne: true
            referencedRelation: "email_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_messages: {
        Row: {
          body_html: string | null
          body_text: string | null
          captured_from_user_id: string | null
          cc_emails: string | null
          client_id: string | null
          created_at: string
          deal_id: string | null
          department: string | null
          direction: string
          from_email: string
          from_name: string | null
          gmail_id: string | null
          id: string
          job_id: string | null
          lead_id: string | null
          message_id: string
          sent_at: string | null
          snippet: string | null
          staff_user_id: string | null
          subject: string | null
          thread_id: string | null
          to_email: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          captured_from_user_id?: string | null
          cc_emails?: string | null
          client_id?: string | null
          created_at?: string
          deal_id?: string | null
          department?: string | null
          direction: string
          from_email: string
          from_name?: string | null
          gmail_id?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          message_id: string
          sent_at?: string | null
          snippet?: string | null
          staff_user_id?: string | null
          subject?: string | null
          thread_id?: string | null
          to_email: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          captured_from_user_id?: string | null
          cc_emails?: string | null
          client_id?: string | null
          created_at?: string
          deal_id?: string | null
          department?: string | null
          direction?: string
          from_email?: string
          from_name?: string | null
          gmail_id?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          message_id?: string
          sent_at?: string | null
          snippet?: string | null
          staff_user_id?: string | null
          subject?: string | null
          thread_id?: string | null
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_messages_captured_from_user_id_fkey"
            columns: ["captured_from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "email_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "email_messages_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_messages_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      email_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
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
          claimed_at?: string | null
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
          claimed_at?: string | null
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
      email_outbox_stage_gate_backup_20260701: {
        Row: {
          cancelled_at: string
          id: string
          prior_last_error: string | null
          prior_status: string
        }
        Insert: {
          cancelled_at?: string
          id: string
          prior_last_error?: string | null
          prior_status: string
        }
        Update: {
          cancelled_at?: string
          id?: string
          prior_last_error?: string | null
          prior_status?: string
        }
        Relationships: []
      }
      email_outbox_stagelock_backup_20260702: {
        Row: {
          cancelled_at: string
          id: string
          prior_last_error: string | null
          prior_status: string
        }
        Insert: {
          cancelled_at?: string
          id: string
          prior_last_error?: string | null
          prior_status: string
        }
        Update: {
          cancelled_at?: string
          id?: string
          prior_last_error?: string | null
          prior_status?: string
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
      email_templates_backup_20260713: {
        Row: {
          body: string | null
          client_facing: boolean | null
          description: string | null
          key: string | null
          subject: string | null
          updated_at: string | null
          variables: string | null
        }
        Insert: {
          body?: string | null
          client_facing?: boolean | null
          description?: string | null
          key?: string | null
          subject?: string | null
          updated_at?: string | null
          variables?: string | null
        }
        Update: {
          body?: string | null
          client_facing?: boolean | null
          description?: string | null
          key?: string | null
          subject?: string | null
          updated_at?: string | null
          variables?: string | null
        }
        Relationships: []
      }
      email_templates_dropped_backup_20260702: {
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
          autopay: boolean
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
          autopay?: boolean
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
          autopay?: boolean
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
      integrity_alert_dismissals: {
        Row: {
          check_key: string
          dismissed_at: string
          dismissed_by: string | null
          id: string
          note: string | null
          signature: string
          subject_id: string
        }
        Insert: {
          check_key: string
          dismissed_at?: string
          dismissed_by?: string | null
          id?: string
          note?: string | null
          signature?: string
          subject_id: string
        }
        Update: {
          check_key?: string
          dismissed_at?: string
          dismissed_by?: string | null
          id?: string
          note?: string | null
          signature?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrity_alert_dismissals_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      job_intake_files: {
        Row: {
          file_name: string
          file_size: number
          id: string
          job_id: string
          mime_type: string | null
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          file_name: string
          file_size: number
          id?: string
          job_id: string
          mime_type?: string | null
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          file_name?: string
          file_size?: number
          id?: string
          job_id?: string
          mime_type?: string | null
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_intake_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_intake_forms: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          expires_at: string
          first_submitted_at: string | null
          job_id: string
          locale: string
          locked_at: string | null
          locked_by: string | null
          logo_path: string | null
          sent_at: string | null
          status: string
          submitted_at: string | null
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          expires_at?: string
          first_submitted_at?: string | null
          job_id: string
          locale?: string
          locked_at?: string | null
          locked_by?: string | null
          logo_path?: string | null
          sent_at?: string | null
          status?: string
          submitted_at?: string | null
          token?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          expires_at?: string
          first_submitted_at?: string | null
          job_id?: string
          locale?: string
          locked_at?: string | null
          locked_by?: string | null
          logo_path?: string | null
          sent_at?: string | null
          status?: string
          submitted_at?: string | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_intake_forms_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          amount_net: number | null
          archived: boolean
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_group_id: string | null
          billing_active: boolean
          billing_group_id: string | null
          billing_only: boolean
          billing_type: string
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          client_id: string
          code: string | null
          completed_at: string | null
          created_at: string
          deal_id: string
          description: string | null
          details: Json
          id: string
          installment_plan: string
          installment_schedule: Json | null
          is_blocked: boolean
          is_custom: boolean
          monthly_amount: number | null
          monthly_tasks: Json
          monthly_tasks_period: string | null
          onboarded_at: string | null
          one_time_amount: number | null
          owner_user_id: string | null
          parent_job_id: string | null
          period_due_date: string | null
          period_start_date: string | null
          recurring_start_date: string | null
          service_type: string
          setup_fee: number | null
          stage_id: string | null
          started_at: string | null
          status: string
          title: string | null
          updated_at: string
          vat_rate: number
        }
        Insert: {
          amount_net?: number | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean
          billing_group_id?: string | null
          billing_only?: boolean
          billing_type: string
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id: string
          code?: string | null
          completed_at?: string | null
          created_at?: string
          deal_id: string
          description?: string | null
          details?: Json
          id?: string
          installment_plan?: string
          installment_schedule?: Json | null
          is_blocked?: boolean
          is_custom?: boolean
          monthly_amount?: number | null
          monthly_tasks?: Json
          monthly_tasks_period?: string | null
          onboarded_at?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          period_due_date?: string | null
          period_start_date?: string | null
          recurring_start_date?: string | null
          service_type: string
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          amount_net?: number | null
          archived?: boolean
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean
          billing_group_id?: string | null
          billing_only?: boolean
          billing_type?: string
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string
          code?: string | null
          completed_at?: string | null
          created_at?: string
          deal_id?: string
          description?: string | null
          details?: Json
          id?: string
          installment_plan?: string
          installment_schedule?: Json | null
          is_blocked?: boolean
          is_custom?: boolean
          monthly_amount?: number | null
          monthly_tasks?: Json
          monthly_tasks_period?: string | null
          onboarded_at?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          period_due_date?: string | null
          period_start_date?: string | null
          recurring_start_date?: string | null
          service_type?: string
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          vat_rate?: number
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
            foreignKeyName: "jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
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
      jobs_000516_aiseo_dupe_backup_20260625: {
        Row: {
          amount_net: number | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_group_id: string | null
          billing_active: boolean | null
          billing_group_id: string | null
          billing_only: boolean | null
          billing_type: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          client_id: string | null
          code: string | null
          completed_at: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          details: Json | null
          id: string | null
          installment_plan: string | null
          installment_schedule: Json | null
          is_blocked: boolean | null
          is_custom: boolean | null
          monthly_amount: number | null
          monthly_tasks: Json | null
          monthly_tasks_period: string | null
          one_time_amount: number | null
          owner_user_id: string | null
          parent_job_id: string | null
          recurring_start_date: string | null
          service_type: string | null
          setup_fee: number | null
          stage_id: string | null
          started_at: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          vat_rate: number | null
        }
        Insert: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          installment_plan?: string | null
          installment_schedule?: Json | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          installment_plan?: string | null
          installment_schedule?: Json | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      jobs_ai_seo_split_backup_20260624: {
        Row: {
          billing_only: boolean | null
          id: string | null
          owner_user_id: string | null
          stage_id: string | null
        }
        Insert: {
          billing_only?: boolean | null
          id?: string | null
          owner_user_id?: string | null
          stage_id?: string | null
        }
        Update: {
          billing_only?: boolean | null
          id?: string | null
          owner_user_id?: string | null
          stage_id?: string | null
        }
        Relationships: []
      }
      jobs_aiseo_004977_fix_backup_20260625: {
        Row: {
          billing_only: boolean | null
          id: string | null
          owner_user_id: string | null
          stage_id: string | null
        }
        Insert: {
          billing_only?: boolean | null
          id?: string | null
          owner_user_id?: string | null
          stage_id?: string | null
        }
        Update: {
          billing_only?: boolean | null
          id?: string | null
          owner_user_id?: string | null
          stage_id?: string | null
        }
        Relationships: []
      }
      jobs_aiseo_del_backup_20260625: {
        Row: {
          amount_net: number | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_group_id: string | null
          billing_active: boolean | null
          billing_group_id: string | null
          billing_only: boolean | null
          billing_type: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          client_id: string | null
          code: string | null
          completed_at: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          details: Json | null
          id: string | null
          installment_plan: string | null
          is_blocked: boolean | null
          is_custom: boolean | null
          monthly_amount: number | null
          monthly_tasks: Json | null
          monthly_tasks_period: string | null
          one_time_amount: number | null
          owner_user_id: string | null
          parent_job_id: string | null
          recurring_start_date: string | null
          service_type: string | null
          setup_fee: number | null
          stage_id: string | null
          started_at: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          vat_rate: number | null
        }
        Insert: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          installment_plan?: string | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          installment_plan?: string | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      jobs_aiseo_dup_backup_20260625: {
        Row: {
          amount_net: number | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_group_id: string | null
          billing_active: boolean | null
          billing_group_id: string | null
          billing_only: boolean | null
          billing_type: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          client_id: string | null
          code: string | null
          completed_at: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          details: Json | null
          id: string | null
          installment_plan: string | null
          is_blocked: boolean | null
          is_custom: boolean | null
          monthly_amount: number | null
          monthly_tasks: Json | null
          monthly_tasks_period: string | null
          one_time_amount: number | null
          owner_user_id: string | null
          parent_job_id: string | null
          recurring_start_date: string | null
          service_type: string | null
          setup_fee: number | null
          stage_id: string | null
          started_at: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          vat_rate: number | null
        }
        Insert: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          installment_plan?: string | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          installment_plan?: string | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      jobs_backup_20260619: {
        Row: {
          amount_net: number | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_group_id: string | null
          billing_active: boolean | null
          billing_group_id: string | null
          billing_only: boolean | null
          billing_type: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          client_id: string | null
          code: string | null
          completed_at: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          details: Json | null
          id: string | null
          is_blocked: boolean | null
          is_custom: boolean | null
          monthly_amount: number | null
          monthly_tasks: Json | null
          monthly_tasks_period: string | null
          one_time_amount: number | null
          owner_user_id: string | null
          recurring_start_date: string | null
          service_type: string | null
          setup_fee: number | null
          stage_id: string | null
          started_at: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          vat_rate: number | null
        }
        Insert: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      jobs_endjob_stage_backup_20260622: {
        Row: {
          backed_up_at: string | null
          id: string | null
          old_stage_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          old_stage_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          old_stage_id?: string | null
        }
        Relationships: []
      }
      jobs_hosting_billing_backup_20260622: {
        Row: {
          backed_up_at: string | null
          id: string | null
          old_billing_type: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          old_billing_type?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          old_billing_type?: string | null
        }
        Relationships: []
      }
      jobs_onboarded_backfill_backup_20260629: {
        Row: {
          backed_up_at: string | null
          job_id: string | null
          prev_onboarded_at: string | null
        }
        Insert: {
          backed_up_at?: string | null
          job_id?: string | null
          prev_onboarded_at?: string | null
        }
        Update: {
          backed_up_at?: string | null
          job_id?: string | null
          prev_onboarded_at?: string | null
        }
        Relationships: []
      }
      jobs_onboarded_backfill_backup_20260702: {
        Row: {
          backed_up_at: string | null
          id: string | null
          onboarded_at_old: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          onboarded_at_old?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          onboarded_at_old?: string | null
        }
        Relationships: []
      }
      jobs_unsplit_aiseo_backup_20260629: {
        Row: {
          billing_active: boolean | null
          billing_only: boolean | null
          deal_id: string | null
          id: string | null
          owner_user_id: string | null
          stage_id: string | null
        }
        Insert: {
          billing_active?: boolean | null
          billing_only?: boolean | null
          deal_id?: string | null
          id?: string | null
          owner_user_id?: string | null
          stage_id?: string | null
        }
        Update: {
          billing_active?: boolean | null
          billing_only?: boolean | null
          deal_id?: string | null
          id?: string | null
          owner_user_id?: string | null
          stage_id?: string | null
        }
        Relationships: []
      }
      jobs_web_dev_info_backfill_backup_20260715: {
        Row: {
          backed_up_at: string | null
          job_id: string | null
          prev_details: Json | null
        }
        Insert: {
          backed_up_at?: string | null
          job_id?: string | null
          prev_details?: Json | null
        }
        Update: {
          backed_up_at?: string | null
          job_id?: string | null
          prev_details?: Json | null
        }
        Relationships: []
      }
      jobs_webdev_dup_archive_backup_20260625: {
        Row: {
          amount_net: number | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          assigned_group_id: string | null
          billing_active: boolean | null
          billing_group_id: string | null
          billing_only: boolean | null
          billing_type: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          client_id: string | null
          code: string | null
          completed_at: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          details: Json | null
          id: string | null
          installment_plan: string | null
          installment_schedule: Json | null
          is_blocked: boolean | null
          is_custom: boolean | null
          monthly_amount: number | null
          monthly_tasks: Json | null
          monthly_tasks_period: string | null
          one_time_amount: number | null
          owner_user_id: string | null
          parent_job_id: string | null
          recurring_start_date: string | null
          service_type: string | null
          setup_fee: number | null
          stage_id: string | null
          started_at: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          vat_rate: number | null
        }
        Insert: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          installment_plan?: string | null
          installment_schedule?: Json | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Update: {
          amount_net?: number | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          assigned_group_id?: string | null
          billing_active?: boolean | null
          billing_group_id?: string | null
          billing_only?: boolean | null
          billing_type?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          client_id?: string | null
          code?: string | null
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          details?: Json | null
          id?: string | null
          installment_plan?: string | null
          installment_schedule?: Json | null
          is_blocked?: boolean | null
          is_custom?: boolean | null
          monthly_amount?: number | null
          monthly_tasks?: Json | null
          monthly_tasks_period?: string | null
          one_time_amount?: number | null
          owner_user_id?: string | null
          parent_job_id?: string | null
          recurring_start_date?: string | null
          service_type?: string | null
          setup_fee?: number | null
          stage_id?: string | null
          started_at?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          vat_rate?: number | null
        }
        Relationships: []
      }
      jobs_website_backfill_backup_20260629: {
        Row: {
          backed_up_at: string | null
          job_id: string | null
          prev_details: Json | null
        }
        Insert: {
          backed_up_at?: string | null
          job_id?: string | null
          prev_details?: Json | null
        }
        Update: {
          backed_up_at?: string | null
          job_id?: string | null
          prev_details?: Json | null
        }
        Relationships: []
      }
      lead_distribution_state: {
        Row: {
          auto_enabled: boolean
          auto_merge_enabled: boolean
          auto_release_enabled: boolean
          id: boolean
          last_assigned_user_id: string | null
          updated_at: string
        }
        Insert: {
          auto_enabled?: boolean
          auto_merge_enabled?: boolean
          auto_release_enabled?: boolean
          id?: boolean
          last_assigned_user_id?: string | null
          updated_at?: string
        }
        Update: {
          auto_enabled?: boolean
          auto_merge_enabled?: boolean
          auto_release_enabled?: boolean
          id?: boolean
          last_assigned_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_distribution_state_last_assigned_user_id_fkey"
            columns: ["last_assigned_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      lead_intake: {
        Row: {
          company_name: string | null
          contact_first_name: string | null
          contact_info: string | null
          contact_last_name: string | null
          created_at: string
          email: string | null
          id: string
          matched_on: string[]
          matches: Json
          merged_into_lead_id: string | null
          phone: string | null
          phone_normalized: string | null
          released_lead_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          source_data: Json | null
          status: string
          title: string | null
          website: string | null
        }
        Insert: {
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          matched_on?: string[]
          matches?: Json
          merged_into_lead_id?: string | null
          phone?: string | null
          phone_normalized?: string | null
          released_lead_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          source_data?: Json | null
          status?: string
          title?: string | null
          website?: string | null
        }
        Update: {
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          matched_on?: string[]
          matches?: Json
          merged_into_lead_id?: string | null
          phone?: string | null
          phone_normalized?: string | null
          released_lead_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          source_data?: Json | null
          status?: string
          title?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_intake_merged_into_lead_id_fkey"
            columns: ["merged_into_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_intake_released_lead_id_fkey"
            columns: ["released_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_intake_company_backup_20260622: {
        Row: {
          backed_up_at: string | null
          company_name: string | null
          id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          company_name?: string | null
          id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          company_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
      lead_intake_phone_backup_20260622: {
        Row: {
          backed_up_at: string | null
          id: string | null
          phone: string | null
          phone_normalized: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          phone?: string | null
          phone_normalized?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          phone?: string | null
          phone_normalized?: string | null
        }
        Relationships: []
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
          business_profile_name: string | null
          business_profile_url: string | null
          cash_charge_vat: boolean
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
          estimated_total_value: number | null
          expected_close_date: string | null
          facebook: string | null
          id: string
          industry: string | null
          instagram: string | null
          intake_log: string | null
          linkedin: string | null
          notes: string | null
          owner_user_id: string | null
          payment_method: string | null
          phone: string | null
          phone_normalized: string | null
          scheduled_for: string | null
          services_planned: Json
          source: string
          source_data: Json | null
          stage_id: string | null
          tiktok: string | null
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
          business_profile_name?: string | null
          business_profile_url?: string | null
          cash_charge_vat?: boolean
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
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json
          source: string
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
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
          business_profile_name?: string | null
          business_profile_url?: string | null
          cash_charge_vat?: boolean
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
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json
          source?: string
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
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
      leads_campaign_backfill_backup_20260622: {
        Row: {
          backed_up_at: string | null
          company_name: string | null
          id: string | null
          notes: string | null
        }
        Insert: {
          backed_up_at?: string | null
          company_name?: string | null
          id?: string | null
          notes?: string | null
        }
        Update: {
          backed_up_at?: string | null
          company_name?: string | null
          id?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      leads_clickup_customer_backup_20260622: {
        Row: {
          additional_contacts: Json | null
          additional_notes: string | null
          address: string | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          automations_enabled: boolean | null
          backed_up_at: string | null
          code: string | null
          company_name: string | null
          contact_first_name: string | null
          contact_info: string | null
          contact_last_name: string | null
          converted_at: string | null
          converted_client_id: string | null
          converted_deal_id: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          email_opt_out: boolean | null
          estimated_monthly_value: number | null
          estimated_one_time_value: number | null
          estimated_total_value: number | null
          expected_close_date: string | null
          facebook: string | null
          id: string | null
          industry: string | null
          instagram: string | null
          intake_log: string | null
          linkedin: string | null
          notes: string | null
          owner_user_id: string | null
          payment_method: string | null
          phone: string | null
          phone_normalized: string | null
          scheduled_for: string | null
          services_planned: Json | null
          source: string | null
          source_data: Json | null
          stage_id: string | null
          tiktok: string | null
          title: string | null
          unsubscribe_token: string | null
          updated_at: string | null
          vat_number: string | null
          website: string | null
          won_by_user_id: string | null
        }
        Insert: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          backed_up_at?: string | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Update: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          backed_up_at?: string | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Relationships: []
      }
      leads_clickup_phone_backup_20260622: {
        Row: {
          backed_up_at: string | null
          id: string | null
          old_phone: string | null
        }
        Insert: {
          backed_up_at?: string | null
          id?: string | null
          old_phone?: string | null
        }
        Update: {
          backed_up_at?: string | null
          id?: string | null
          old_phone?: string | null
        }
        Relationships: []
      }
      leads_client_dup_backup_20260622: {
        Row: {
          additional_contacts: Json | null
          additional_notes: string | null
          address: string | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          automations_enabled: boolean | null
          backed_up_at: string | null
          code: string | null
          company_name: string | null
          contact_first_name: string | null
          contact_info: string | null
          contact_last_name: string | null
          converted_at: string | null
          converted_client_id: string | null
          converted_deal_id: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          email_opt_out: boolean | null
          estimated_monthly_value: number | null
          estimated_one_time_value: number | null
          estimated_total_value: number | null
          expected_close_date: string | null
          facebook: string | null
          id: string | null
          industry: string | null
          instagram: string | null
          intake_log: string | null
          linkedin: string | null
          notes: string | null
          owner_user_id: string | null
          payment_method: string | null
          phone: string | null
          phone_normalized: string | null
          scheduled_for: string | null
          services_planned: Json | null
          source: string | null
          source_data: Json | null
          stage_id: string | null
          tiktok: string | null
          title: string | null
          unsubscribe_token: string | null
          updated_at: string | null
          vat_number: string | null
          website: string | null
          won_by_user_id: string | null
        }
        Insert: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          backed_up_at?: string | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Update: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          backed_up_at?: string | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Relationships: []
      }
      leads_dedup_backup_20260622: {
        Row: {
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          backed_up_at: string | null
          dedup_dim: string | null
          id: string | null
          kept_into: string | null
          notes: string | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          backed_up_at?: string | null
          dedup_dim?: string | null
          id?: string | null
          kept_into?: string | null
          notes?: string | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          backed_up_at?: string | null
          dedup_dim?: string | null
          id?: string | null
          kept_into?: string | null
          notes?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      leads_dup_merge_backup_20260624: {
        Row: {
          additional_contacts: Json | null
          additional_notes: string | null
          address: string | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          automations_enabled: boolean | null
          backed_up_at: string | null
          code: string | null
          company_name: string | null
          contact_first_name: string | null
          contact_info: string | null
          contact_last_name: string | null
          converted_at: string | null
          converted_client_id: string | null
          converted_deal_id: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          email_opt_out: boolean | null
          estimated_monthly_value: number | null
          estimated_one_time_value: number | null
          estimated_total_value: number | null
          expected_close_date: string | null
          facebook: string | null
          id: string | null
          industry: string | null
          instagram: string | null
          intake_log: string | null
          linkedin: string | null
          notes: string | null
          owner_user_id: string | null
          payment_method: string | null
          phone: string | null
          phone_normalized: string | null
          scheduled_for: string | null
          services_planned: Json | null
          source: string | null
          source_data: Json | null
          stage_id: string | null
          tiktok: string | null
          title: string | null
          unsubscribe_token: string | null
          updated_at: string | null
          vat_number: string | null
          website: string | null
          won_by_user_id: string | null
        }
        Insert: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          backed_up_at?: string | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Update: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          backed_up_at?: string | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Relationships: []
      }
      leads_dup_merge_backup_20260701: {
        Row: {
          backed_up_at: string | null
          keeper_id: string | null
          keeper_prev_additional_contacts: Json | null
          keeper_prev_intake_log: string | null
          keeper_prev_notes: string | null
          keeper_prev_stage_id: string | null
          loser_id: string | null
          loser_row: Json | null
          match_key: string | null
          match_kind: string | null
        }
        Insert: {
          backed_up_at?: string | null
          keeper_id?: string | null
          keeper_prev_additional_contacts?: Json | null
          keeper_prev_intake_log?: string | null
          keeper_prev_notes?: string | null
          keeper_prev_stage_id?: string | null
          loser_id?: string | null
          loser_row?: Json | null
          match_key?: string | null
          match_kind?: string | null
        }
        Update: {
          backed_up_at?: string | null
          keeper_id?: string | null
          keeper_prev_additional_contacts?: Json | null
          keeper_prev_intake_log?: string | null
          keeper_prev_notes?: string | null
          keeper_prev_stage_id?: string | null
          loser_id?: string | null
          loser_row?: Json | null
          match_key?: string | null
          match_kind?: string | null
        }
        Relationships: []
      }
      leads_dup_won_delete_backup_20260623: {
        Row: {
          additional_contacts: Json | null
          additional_notes: string | null
          address: string | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          automations_enabled: boolean | null
          code: string | null
          company_name: string | null
          contact_first_name: string | null
          contact_info: string | null
          contact_last_name: string | null
          converted_at: string | null
          converted_client_id: string | null
          converted_deal_id: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          email_opt_out: boolean | null
          estimated_monthly_value: number | null
          estimated_one_time_value: number | null
          estimated_total_value: number | null
          expected_close_date: string | null
          facebook: string | null
          id: string | null
          industry: string | null
          instagram: string | null
          intake_log: string | null
          linkedin: string | null
          notes: string | null
          owner_user_id: string | null
          payment_method: string | null
          phone: string | null
          phone_normalized: string | null
          scheduled_for: string | null
          services_planned: Json | null
          source: string | null
          source_data: Json | null
          stage_id: string | null
          tiktok: string | null
          title: string | null
          unsubscribe_token: string | null
          updated_at: string | null
          vat_number: string | null
          website: string | null
          won_by_user_id: string | null
        }
        Insert: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Update: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Relationships: []
      }
      leads_email_backfill_backup_20260624: {
        Row: {
          backed_up_at: string | null
          code: string | null
          id: string | null
          old_email: string | null
          source_data: Json | null
        }
        Insert: {
          backed_up_at?: string | null
          code?: string | null
          id?: string | null
          old_email?: string | null
          source_data?: Json | null
        }
        Update: {
          backed_up_at?: string | null
          code?: string | null
          id?: string | null
          old_email?: string | null
          source_data?: Json | null
        }
        Relationships: []
      }
      leads_junk_phone_backup_20260624: {
        Row: {
          backed_up_at: string | null
          code: string | null
          id: string | null
          old_phone: string | null
        }
        Insert: {
          backed_up_at?: string | null
          code?: string | null
          id?: string | null
          old_phone?: string | null
        }
        Update: {
          backed_up_at?: string | null
          code?: string | null
          id?: string | null
          old_phone?: string | null
        }
        Relationships: []
      }
      leads_owner_reassign_backup_20260630: {
        Row: {
          backed_up_at: string
          lead_id: string
          new_owner_user_id: string | null
          prev_owner_user_id: string | null
        }
        Insert: {
          backed_up_at?: string
          lead_id: string
          new_owner_user_id?: string | null
          prev_owner_user_id?: string | null
        }
        Update: {
          backed_up_at?: string
          lead_id?: string
          new_owner_user_id?: string | null
          prev_owner_user_id?: string | null
        }
        Relationships: []
      }
      leads_phonedup_merge_backup_20260624: {
        Row: {
          additional_contacts: Json | null
          additional_notes: string | null
          address: string | null
          archived: boolean | null
          archived_at: string | null
          archived_by: string | null
          archived_reason: string | null
          automations_enabled: boolean | null
          backed_up_at: string | null
          code: string | null
          company_name: string | null
          contact_first_name: string | null
          contact_info: string | null
          contact_last_name: string | null
          converted_at: string | null
          converted_client_id: string | null
          converted_deal_id: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          email_opt_out: boolean | null
          estimated_monthly_value: number | null
          estimated_one_time_value: number | null
          estimated_total_value: number | null
          expected_close_date: string | null
          facebook: string | null
          id: string | null
          industry: string | null
          instagram: string | null
          intake_log: string | null
          linkedin: string | null
          notes: string | null
          owner_user_id: string | null
          payment_method: string | null
          phone: string | null
          phone_normalized: string | null
          scheduled_for: string | null
          services_planned: Json | null
          source: string | null
          source_data: Json | null
          stage_id: string | null
          tiktok: string | null
          title: string | null
          unsubscribe_token: string | null
          updated_at: string | null
          vat_number: string | null
          website: string | null
          won_by_user_id: string | null
        }
        Insert: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          backed_up_at?: string | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Update: {
          additional_contacts?: Json | null
          additional_notes?: string | null
          address?: string | null
          archived?: boolean | null
          archived_at?: string | null
          archived_by?: string | null
          archived_reason?: string | null
          automations_enabled?: boolean | null
          backed_up_at?: string | null
          code?: string | null
          company_name?: string | null
          contact_first_name?: string | null
          contact_info?: string | null
          contact_last_name?: string | null
          converted_at?: string | null
          converted_client_id?: string | null
          converted_deal_id?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_opt_out?: boolean | null
          estimated_monthly_value?: number | null
          estimated_one_time_value?: number | null
          estimated_total_value?: number | null
          expected_close_date?: string | null
          facebook?: string | null
          id?: string | null
          industry?: string | null
          instagram?: string | null
          intake_log?: string | null
          linkedin?: string | null
          notes?: string | null
          owner_user_id?: string | null
          payment_method?: string | null
          phone?: string | null
          phone_normalized?: string | null
          scheduled_for?: string | null
          services_planned?: Json | null
          source?: string | null
          source_data?: Json | null
          stage_id?: string | null
          tiktok?: string | null
          title?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
          vat_number?: string | null
          website?: string | null
          won_by_user_id?: string | null
        }
        Relationships: []
      }
      leads_won_backfill_backup_20260623: {
        Row: {
          action: string
          deal_id: string | null
          inserted_at: string
          lead_id: string
        }
        Insert: {
          action: string
          deal_id?: string | null
          inserted_at?: string
          lead_id: string
        }
        Update: {
          action?: string
          deal_id?: string | null
          inserted_at?: string
          lead_id?: string
        }
        Relationships: []
      }
      lifecycle_cleanup_jobs_backup_20260626: {
        Row: {
          backed_up_at: string | null
          blocked_reason: string | null
          completed_at: string | null
          deal_id: string | null
          is_blocked: boolean | null
          job_id: string | null
          stage_id: string | null
          status: string | null
        }
        Insert: {
          backed_up_at?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          deal_id?: string | null
          is_blocked?: boolean | null
          job_id?: string | null
          stage_id?: string | null
          status?: string | null
        }
        Update: {
          backed_up_at?: string | null
          blocked_reason?: string | null
          completed_at?: string | null
          deal_id?: string | null
          is_blocked?: boolean | null
          job_id?: string | null
          stage_id?: string | null
          status?: string | null
        }
        Relationships: []
      }
      localseo_renewal_backup_20260626: {
        Row: {
          backed_up_at: string | null
          deal_id: string | null
          job_id: string | null
          prev_blocked: boolean | null
          prev_stage_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          deal_id?: string | null
          job_id?: string | null
          prev_blocked?: boolean | null
          prev_stage_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          deal_id?: string | null
          job_id?: string | null
          prev_blocked?: boolean | null
          prev_stage_id?: string | null
        }
        Relationships: []
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
          restricted_to_user_id: string | null
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
          restricted_to_user_id?: string | null
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
          restricted_to_user_id?: string | null
          terminal_outcome?: string | null
          triggers_action?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pro_formas: {
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
          paid_at: string | null
          pdf_path: string | null
          pro_forma_number: string | null
          sent_at: string | null
          source_offer_id: string | null
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
          paid_at?: string | null
          pdf_path?: string | null
          pro_forma_number?: string | null
          sent_at?: string | null
          source_offer_id?: string | null
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
          paid_at?: string | null
          pdf_path?: string | null
          pro_forma_number?: string | null
          sent_at?: string | null
          source_offer_id?: string | null
          status?: string
          totals?: Json
          updated_at?: string
          validity_days?: number
          vat_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "pro_formas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pro_formas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "pro_formas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "pro_formas_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pro_formas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pro_formas_source_offer_id_fkey"
            columns: ["source_offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
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
          exclude_from_lead_distribution: boolean
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
          exclude_from_lead_distribution?: boolean
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
          exclude_from_lead_distribution?: boolean
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
      seo_onboarding_config: {
        Row: {
          cutover_at: string
          id: boolean
        }
        Insert: {
          cutover_at: string
          id?: boolean
        }
        Update: {
          cutover_at?: string
          id?: boolean
        }
        Relationships: []
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
      shared_mailboxes: {
        Row: {
          created_at: string
          department: string
          email: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department: string
          email: string
          user_id: string
        }
        Update: {
          created_at?: string
          department?: string
          email?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_mailboxes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      task_comments: {
        Row: {
          assigned_task_id: string | null
          author_user_id: string
          body: string
          created_at: string
          id: string
          user_task_id: string | null
        }
        Insert: {
          assigned_task_id?: string | null
          author_user_id: string
          body: string
          created_at?: string
          id?: string
          user_task_id?: string | null
        }
        Update: {
          assigned_task_id?: string | null
          author_user_id?: string
          body?: string
          created_at?: string
          id?: string
          user_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_assigned_task_id_fkey"
            columns: ["assigned_task_id"]
            isOneToOne: false
            referencedRelation: "assigned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_comments_user_task_id_fkey"
            columns: ["user_task_id"]
            isOneToOne: false
            referencedRelation: "user_tasks"
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
          scopes: string | null
          user_id: string
        }
        Insert: {
          connected_at?: string
          google_email: string
          refresh_token_enc: string
          revoked_at?: string | null
          scopes?: string | null
          user_id: string
        }
        Update: {
          connected_at?: string
          google_email?: string
          refresh_token_enc?: string
          revoked_at?: string | null
          scopes?: string | null
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
      user_google_sync: {
        Row: {
          backfill_page_token: string | null
          backfilled_at: string | null
          last_synced_at: string | null
          user_id: string
        }
        Insert: {
          backfill_page_token?: string | null
          backfilled_at?: string | null
          last_synced_at?: string | null
          user_id: string
        }
        Update: {
          backfill_page_token?: string | null
          backfilled_at?: string | null
          last_synced_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_google_sync_user_id_fkey"
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
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          due_at: string
          id: string
          importance: string
          job_id: string | null
          lead_id: string | null
          notes: string | null
          started_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_at: string
          id?: string
          importance?: string
          job_id?: string | null
          lead_id?: string | null
          notes?: string | null
          started_at?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_at?: string
          id?: string
          importance?: string
          job_id?: string | null
          lead_id?: string | null
          notes?: string | null
          started_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "tech_my_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "user_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
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
      webseo_renewal_backup_20260626: {
        Row: {
          backed_up_at: string | null
          deal_id: string | null
          job_id: string | null
          prev_blocked: boolean | null
          prev_stage_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          deal_id?: string | null
          job_id?: string | null
          prev_blocked?: boolean | null
          prev_stage_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          deal_id?: string | null
          job_id?: string | null
          prev_blocked?: boolean | null
          prev_stage_id?: string | null
        }
        Relationships: []
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
      deal_payments_with_totals: {
        Row: {
          amount: number | null
          amount_gross: number | null
          amount_net: number | null
          billing_type: string | null
          created_at: string | null
          deal_id: string | null
          end_date: string | null
          id: string | null
          invoice_number: string | null
          label: string | null
          line_count: number | null
          paid_at: string | null
          service_index: number | null
          service_type: string | null
          start_date: string | null
          status: string | null
          total_gross: number | null
          total_net: number | null
          total_vat: number | null
          updated_at: string | null
          vat_amount: number | null
          vat_rate: number | null
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
      accounting_create_deal: {
        Args: {
          p_cash_charge_vat?: boolean
          p_client_id?: string
          p_description?: string
          p_monthly?: number
          p_new_client?: Json
          p_one_time?: number
          p_payment_method?: string
          p_title?: string
        }
        Returns: Json
      }
      accounting_integrity_alerts: {
        Args: never
        Returns: {
          category: string
          check_key: string
          deal_id: string
          detail: string
          job_id: string
          severity: string
          signature: string
          subject_code: string
          subject_id: string
          subject_type: string
          title: string
        }[]
      }
      accounting_integrity_alerts_count: { Args: never; Returns: number }
      accounting_mark_paid_in_full: {
        Args: { target_deal_id: string }
        Returns: Json
      }
      apply_intake_merge: {
        Args: {
          p_lead_id: string
          r: Database["public"]["Tables"]["lead_intake"]["Row"]
        }
        Returns: undefined
      }
      apply_intake_reengage_merge: {
        Args: {
          p_lead_id: string
          r: Database["public"]["Tables"]["lead_intake"]["Row"]
        }
        Returns: undefined
      }
      apply_lead_shuffle: {
        Args: { p_assignments: Json; p_stage_code: string }
        Returns: number
      }
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
      block_deal_jobs: { Args: { p_deal_id: string }; Returns: undefined }
      block_job: {
        Args: { reason?: string; target_job_id: string }
        Returns: Json
      }
      build_lead_info_block: {
        Args: { p_source_data: Json; p_title?: string }
        Returns: string
      }
      bulk_merge_intake: { Args: { p_limit?: number }; Returns: Json }
      bulk_merge_intake_preview: { Args: never; Returns: Json }
      bulk_release_intake: { Args: { p_limit?: number }; Returns: Json }
      bulk_release_intake_preview: { Args: never; Returns: Json }
      claim_email_outbox: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          claimed_at: string | null
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
        }[]
        SetofOptions: {
          from: "*"
          to: "email_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      close_deal: { Args: { p_deal_id: string; p_jobs?: Json }; Returns: Json }
      complete_accounting: { Args: { target_deal_id: string }; Returns: Json }
      convert_lead_to_client: {
        Args: { target_lead_id: string }
        Returns: Json
      }
      create_announcement: {
        Args: {
          p_body: string
          p_expires_at?: string
          p_group_ids?: string[]
          p_severity?: string
          p_target_all?: boolean
          p_title: string
        }
        Returns: Json
      }
      create_custom_job: {
        Args: {
          p_amount_net: number
          p_billing_only?: boolean
          p_billing_type: string
          p_deal_id: string
          p_department: string
          p_description: string
          p_force?: boolean
          p_installment_plan?: string
          p_installment_schedule?: Json
          p_setup_fee?: number
          p_title: string
          p_vat_rate: number
        }
        Returns: Json
      }
      current_user_can: {
        Args: { target_action: string; target_board: string }
        Returns: boolean
      }
      current_user_in_group: { Args: { p_code: string }; Returns: boolean }
      current_user_is_admin: { Args: never; Returns: boolean }
      current_user_scope: {
        Args: { target_action: string; target_board: string }
        Returns: string
      }
      deal_email_statuses: {
        Args: { p_deal_id: string }
        Returns: {
          bounced_at: string
          created_at: string
          dedupe_key: string
          delivered_at: string
          error: string
          id: string
          status: string
          template_key: string
          to_email: string
        }[]
      }
      deal_next_due: { Args: { p_deal_id: string }; Returns: string }
      delete_announcement: { Args: { p_id: string }; Returns: Json }
      delete_jobs: { Args: { p_ids: string[] }; Returns: Json }
      delete_leads: { Args: { p_ids: string[] }; Returns: Json }
      discard_lead_intake: { Args: { p_id: string }; Returns: Json }
      dismiss_announcement: { Args: { p_id: string }; Returns: Json }
      dismiss_integrity_alert: {
        Args: {
          p_check_key: string
          p_note?: string
          p_signature?: string
          p_subject_id: string
        }
        Returns: string
      }
      distribute_unassigned_leads: { Args: never; Returns: number }
      email_automation_enabled: {
        Args: { setting_key: string }
        Returns: boolean
      }
      email_failure_rows: {
        Args: never
        Returns: {
          created_at: string
          error: string
          id: string
          recipient_id: string
          recipient_kind: string
          recipient_name: string
          status: string
          template_key: string
          to_email: string
        }[]
      }
      email_outbox_cancel: { Args: { p_id: string }; Returns: Json }
      email_outbox_retry: { Args: { p_id: string }; Returns: Json }
      email_pipeline_health: { Args: never; Returns: Json }
      email_queue_rows: {
        Args: never
        Returns: {
          attempts: number
          created_at: string
          id: string
          last_error: string
          recipient_id: string
          recipient_kind: string
          recipient_name: string
          status: string
          template_key: string
          to_email: string
        }[]
      }
      email_setting_department: {
        Args: { setting_key: string }
        Returns: string
      }
      end_job: { Args: { p_job_id: string }; Returns: Json }
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
      ensure_recurring_payments_v2: { Args: never; Returns: number }
      find_contact_by_phone: {
        Args: { p_key: string }
        Returns: {
          contact_first_name: string
          contact_last_name: string
          email: string
          id: string
          name: string
          phone: string
          source: string
        }[]
      }
      find_lead_duplicates: {
        Args: { p_email: string; p_phone: string }
        Returns: {
          context: string
          display_name: string
          match_type: string
          matched_email: string
          matched_field: string
          matched_phone: string
          record_id: string
        }[]
      }
      first_email_in_jsonb: { Args: { p: Json }; Returns: string }
      first_phone_in_jsonb: { Args: { p: Json }; Returns: string }
      format_intake_merge_block: {
        Args: { r: Database["public"]["Tables"]["lead_intake"]["Row"] }
        Returns: string
      }
      gbp_access_sent_map: {
        Args: never
        Returns: {
          last_sent: string
          to_email: string
        }[]
      }
      generate_job_code: {
        Args: { p_deal_id: string; p_service_type: string }
        Returns: string
      }
      generate_lead_code: { Args: never; Returns: string }
      generate_payments_for_deal: {
        Args: { target_deal_id: string }
        Returns: undefined
      }
      get_my_announcements: {
        Args: never
        Returns: {
          body: string
          created_at: string
          id: string
          severity: string
          title: string
        }[]
      }
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
      gmail_sync_health: { Args: never; Returns: Json }
      group_member_ids: { Args: { p_code: string }; Returns: string[] }
      import_leads_to_intake: { Args: { p_rows: Json }; Returns: Json }
      is_client_blocked: {
        Args: { target_client_id: string }
        Returns: boolean
      }
      is_task_party: {
        Args: { p_assigned_task: string; p_user_task: string }
        Returns: boolean
      }
      job_billing_ref_count: { Args: { p_job_id: string }; Returns: number }
      job_emails: {
        Args: { p_job_id: string }
        Returns: {
          body_html: string | null
          body_text: string | null
          captured_from_user_id: string | null
          cc_emails: string | null
          client_id: string | null
          created_at: string
          deal_id: string | null
          department: string | null
          direction: string
          from_email: string
          from_name: string | null
          gmail_id: string | null
          id: string
          job_id: string | null
          lead_id: string | null
          message_id: string
          sent_at: string | null
          snippet: string | null
          staff_user_id: string | null
          subject: string | null
          thread_id: string | null
          to_email: string
        }[]
        SetofOptions: {
          from: "*"
          to: "email_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      job_pause_billing: { Args: { p_job_id: string }; Returns: Json }
      job_resume_billing: { Args: { p_job_id: string }; Returns: Json }
      job_service_abbr: { Args: { st: string }; Returns: string }
      lead_cold_ids: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
        }[]
      }
      lead_dead_end_ids: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
        }[]
      }
      lead_email_payload: {
        Args: { l: Database["public"]["Tables"]["leads"]["Row"] }
        Returns: Json
      }
      lead_is_dead_end: { Args: { p_lead_id: string }; Returns: boolean }
      lead_shuffle_pool: { Args: never; Returns: string[] }
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
      merge_lead_intake: {
        Args: { p_id: string; p_target_lead_id: string }
        Returns: Json
      }
      move_overdue_deals_to_on_hold: { Args: never; Returns: number }
      my_google_status: {
        Args: never
        Returns: {
          connected: boolean
          google_email: string
        }[]
      }
      pick_next_sales_assignee: { Args: never; Returns: string }
      process_email_sequences: { Args: never; Returns: number }
      profile_directory: {
        Args: never
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      recompute_deal_job_period_dates: {
        Args: { p_deal_id: string }
        Returns: undefined
      }
      recompute_job_period_dates: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      reconcile_block_lifecycle: {
        Args: { p_allow_release?: boolean }
        Returns: number
      }
      reconcile_deal_stage: { Args: { p_deal_id: string }; Returns: boolean }
      reconcile_offboard_jobs: { Args: never; Returns: number }
      reconcile_payment_integrity: { Args: never; Returns: number }
      reconcile_seo_onboarding_emails: { Args: never; Returns: number }
      recover_stale_email_claims: {
        Args: { p_older_than?: string }
        Returns: number
      }
      reengage_lead_intake: {
        Args: { p_id: string; p_target_lead_id: string }
        Returns: Json
      }
      release_billing_jobs_for_deal: {
        Args: { target_deal_id: string }
        Returns: number
      }
      release_deal_jobs: { Args: { p_deal_id: string }; Returns: undefined }
      release_jobs_for_deal: {
        Args: { partial_payment_mode: boolean; target_deal_id: string }
        Returns: number
      }
      release_lead_intake: {
        Args: { p_force?: boolean; p_id: string }
        Returns: Json
      }
      resolve_email_filing: {
        Args: { p_from: string; p_subject: string; p_to: string }
        Returns: {
          client_id: string
          deal_id: string
          department: string
          direction: string
          job_id: string
          lead_id: string
          staff_user_id: string
        }[]
      }
      run_daily_expenses: { Args: never; Returns: undefined }
      run_daily_payment_reminders: { Args: never; Returns: number }
      run_monthly_task_reset: { Args: never; Returns: undefined }
      sales_kanban_counts: {
        Args: { p_owner?: string; p_search?: string; p_source?: string }
        Returns: {
          stage_id: string
          total: number
        }[]
      }
      sales_pool_ids: { Args: never; Returns: string[] }
      sales_stage_rank: { Args: { p_code: string }; Returns: number }
      seed_deal_jobs_and_payments: {
        Args: { target_deal_id: string }
        Returns: undefined
      }
      seed_deal_payments: {
        Args: { target_deal_id: string }
        Returns: undefined
      }
      seo_access_sent_map: {
        Args: never
        Returns: {
          last_sent: string
          template_key: string
          to_email: string
        }[]
      }
      seo_onboarding_pending_jobs: {
        Args: never
        Returns: {
          code: string
          deal_id: string
          dedupe_key: string
          job_id: string
          name: string
          service_type: string
          setting_key: string
          template_key: string
          to_email: string
        }[]
      }
      set_announcement_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: Json
      }
      set_expense_autopay: {
        Args: {
          p_enabled: boolean
          p_expense_id: string
          p_payment_method?: string
        }
        Returns: number
      }
      set_job_monthly_task: {
        Args: { p_code: string; p_completed: boolean; p_job_id: string }
        Returns: undefined
      }
      settle_autopay_expenses: { Args: never; Returns: number }
      shared_mailbox_status: {
        Args: never
        Returns: {
          backfilled: boolean
          connected: boolean
          department: string
          email: string
          google_email: string
          last_synced_at: string
          user_id: string
        }[]
      }
      target_accounting_stage: {
        Args: { next_due: string; today: string }
        Returns: string
      }
      task_target_job_id: {
        Args: {
          p_deal_id: string
          p_department_group_id: string
          p_job_id: string
        }
        Returns: string
      }
      team_lead_for_group: { Args: { p_group_code: string }; Returns: string }
      unblock_client: { Args: { target_client_id: string }; Returns: Json }
      unblock_job: { Args: { target_job_id: string }; Returns: Json }
      undismiss_integrity_alert: { Args: { p_id: string }; Returns: undefined }
      update_job_billing: {
        Args: {
          p_amount_net?: number
          p_billing_group_id?: string
          p_billing_type?: string
          p_clear_group?: boolean
          p_description?: string
          p_installment_plan?: string
          p_installment_schedule?: Json
          p_job_id: string
          p_title?: string
          p_vat_rate?: number
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
