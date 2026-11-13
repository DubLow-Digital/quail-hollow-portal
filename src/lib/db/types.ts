/**
 * Database types for supabase-js, mirroring supabase/migrations. Keep in sync when the
 * schema changes (or regenerate with `supabase gen types typescript --linked`).
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ClientStatus = 'invited' | 'active' | 'archived';
export type RequestStatus = 'requested' | 'uploaded' | 'accepted' | 'redo';
export type UploadStatus = 'pending' | 'complete' | 'failed';
export type ActorType = 'client' | 'admin' | 'system';
export type EntityType = 'individual' | 'schedule_c' | '1120s' | '1065' | 'other';
export type CaptureMethod = 'photo' | 'scan' | 'file';
export type SyncState = 'off' | 'pending' | 'ok' | 'error';

type Rel<FK extends string, Col extends string, Ref extends string> = {
  foreignKeyName: FK;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: ['id'];
};

export type Database = {
  public: {
    Tables: {
      admins: {
        Row: {
          id: string;
          email: string;
          display_name: string;
          ms_object_id: string | null;
          created_at: string;
          last_login_at: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          display_name?: string;
          ms_object_id?: string | null;
          created_at?: string;
          last_login_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['admins']['Insert']>;
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          email: string;
          phone: string | null;
          entity_types: EntityType[];
          status: ClientStatus;
          sharepoint_drive_id: string | null;
          sharepoint_folder_id: string | null;
          sharepoint_folder_path: string | null;
          sharepoint_folder_web_url: string | null;
          auth_user_id: string | null;
          invited_at: string | null;
          last_login_at: string | null;
          notion_page_id: string | null;
          ghl_contact_id: string | null;
          sync_state: SyncState;
          sync_error: string | null;
          synced_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          first_name: string;
          last_name: string;
          email: string;
          phone?: string | null;
          entity_types?: EntityType[];
          status?: ClientStatus;
          sharepoint_drive_id?: string | null;
          sharepoint_folder_id?: string | null;
          sharepoint_folder_path?: string | null;
          sharepoint_folder_web_url?: string | null;
          auth_user_id?: string | null;
          invited_at?: string | null;
          last_login_at?: string | null;
          notion_page_id?: string | null;
          ghl_contact_id?: string | null;
          sync_state?: SyncState;
          sync_error?: string | null;
          synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['clients']['Insert']>;
        Relationships: [];
      };
      document_types: {
        Row: {
          id: string;
          name: string;
          description: string;
          slug_for_filename: string;
          naming_template: string;
          target_subfolder: string;
          accepted_mime: string[];
          max_mb: number;
          requires_year: boolean;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string;
          slug_for_filename: string;
          naming_template?: string;
          target_subfolder?: string;
          accepted_mime?: string[];
          max_mb?: number;
          requires_year?: boolean;
          active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['document_types']['Insert']>;
        Relationships: [];
      };
      request_bundles: {
        Row: { id: string; name: string; description: string; created_at: string };
        Insert: { id?: string; name: string; description?: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['request_bundles']['Insert']>;
        Relationships: [];
      };
      request_bundle_items: {
        Row: { bundle_id: string; document_type_id: string; sort_order: number };
        Insert: { bundle_id: string; document_type_id: string; sort_order?: number };
        Update: Partial<Database['public']['Tables']['request_bundle_items']['Insert']>;
        Relationships: [
          Rel<'request_bundle_items_bundle_id_fkey', 'bundle_id', 'request_bundles'>,
          Rel<'request_bundle_items_document_type_id_fkey', 'document_type_id', 'document_types'>,
        ];
      };
      document_requests: {
        Row: {
          id: string;
          client_id: string;
          document_type_id: string;
          tax_year: number | null;
          business_name: string | null;
          note_to_client: string | null;
          redo_note: string | null;
          status: RequestStatus;
          requested_by: string | null;
          requested_at: string;
          due_date: string | null;
          status_changed_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          document_type_id: string;
          tax_year?: number | null;
          business_name?: string | null;
          note_to_client?: string | null;
          redo_note?: string | null;
          status?: RequestStatus;
          requested_by?: string | null;
          requested_at?: string;
          due_date?: string | null;
          status_changed_at?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['document_requests']['Insert']>;
        Relationships: [
          Rel<'document_requests_client_id_fkey', 'client_id', 'clients'>,
          Rel<'document_requests_document_type_id_fkey', 'document_type_id', 'document_types'>,
        ];
      };
      uploads: {
        Row: {
          id: string;
          request_id: string;
          client_id: string;
          final_filename: string;
          target_folder_id: string;
          target_folder_path: string;
          sharepoint_item_id: string | null;
          sharepoint_web_url: string | null;
          declared_size_bytes: number;
          size_bytes: number | null;
          mime: string;
          page_count: number | null;
          capture_method: CaptureMethod;
          status: UploadStatus;
          failure_reason: string | null;
          started_at: string;
          uploaded_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          request_id: string;
          client_id: string;
          final_filename: string;
          target_folder_id: string;
          target_folder_path: string;
          sharepoint_item_id?: string | null;
          sharepoint_web_url?: string | null;
          declared_size_bytes: number;
          size_bytes?: number | null;
          mime: string;
          page_count?: number | null;
          capture_method?: CaptureMethod;
          status?: UploadStatus;
          failure_reason?: string | null;
          started_at?: string;
          uploaded_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['uploads']['Insert']>;
        Relationships: [
          Rel<'uploads_request_id_fkey', 'request_id', 'document_requests'>,
          Rel<'uploads_client_id_fkey', 'client_id', 'clients'>,
        ];
      };
      audit_log: {
        Row: {
          id: number;
          actor_type: ActorType;
          actor_id: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          metadata: Json;
          ip: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          actor_type: ActorType;
          actor_id?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: Json;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      rate_limits: {
        Row: { key: string; window_start: string; count: number };
        Insert: { key: string; window_start: string; count: number };
        Update: Partial<Database['public']['Tables']['rate_limits']['Insert']>;
        Relationships: [];
      };
      portal_settings: {
        Row: { key: string; value: string; updated_by: string | null; updated_at: string };
        Insert: { key: string; value: string; updated_by?: string | null; updated_at?: string };
        Update: Partial<Database['public']['Tables']['portal_settings']['Insert']>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      rate_limit_hit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number };
        Returns: boolean;
      };
    };
    Enums: {
      client_status: ClientStatus;
      request_status: RequestStatus;
      upload_status: UploadStatus;
      actor_type: ActorType;
      entity_type: EntityType;
      capture_method: CaptureMethod;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
