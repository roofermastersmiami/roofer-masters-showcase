export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      client_portal_links: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          lead_id: string;
          revoked_at: string | null;
          token: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          lead_id: string;
          revoked_at?: string | null;
          token?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          lead_id?: string;
          revoked_at?: string | null;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_portal_links_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_activity: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          kind: string;
          lead_id: string | null;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          kind: string;
          lead_id?: string | null;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          lead_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_activity_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_companies: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      crm_company_branding: {
        Row: {
          company_id: string;
          logo_path: string | null;
          sidebar_appearance: string;
          theme_accent: string;
          theme_palette: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          company_id: string;
          logo_path?: string | null;
          sidebar_appearance?: string;
          theme_accent?: string;
          theme_palette?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          company_id?: string;
          logo_path?: string | null;
          sidebar_appearance?: string;
          theme_accent?: string;
          theme_palette?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_company_branding_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "crm_companies";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_company_memberships: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          role: string;
          user_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_company_memberships_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "crm_companies";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_customers: {
        Row: {
          billing_address: string;
          created_at: string;
          customer_type: string;
          email: string;
          id: string;
          name: string;
          notes: string;
          phone: string;
          source_lead_id: string | null;
        };
        Insert: {
          billing_address?: string;
          created_at?: string;
          customer_type?: string;
          email?: string;
          id?: string;
          name: string;
          notes?: string;
          phone?: string;
          source_lead_id?: string | null;
        };
        Update: {
          billing_address?: string;
          created_at?: string;
          customer_type?: string;
          email?: string;
          id?: string;
          name?: string;
          notes?: string;
          phone?: string;
          source_lead_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_customers_source_lead_id_fkey";
            columns: ["source_lead_id"];
            isOneToOne: true;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_expenses: {
        Row: {
          amount_cents: number;
          category: string;
          created_at: string;
          description: string;
          environment: string;
          id: string;
          incurred_at: string;
          job_id: string | null;
          payee: string;
          receipt_path: string | null;
        };
        Insert: {
          amount_cents: number;
          category: string;
          created_at?: string;
          description: string;
          environment?: string;
          id?: string;
          incurred_at: string;
          job_id?: string | null;
          payee?: string;
          receipt_path?: string | null;
        };
        Update: {
          amount_cents?: number;
          category?: string;
          created_at?: string;
          description?: string;
          environment?: string;
          id?: string;
          incurred_at?: string;
          job_id?: string | null;
          payee?: string;
          receipt_path?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "crm_expenses_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "roof_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_invoices: {
        Row: {
          created_at: string;
          customer_address: string;
          customer_email: string;
          customer_name: string;
          deposit_cents: number;
          due_date: string;
          environment: string;
          expires_at: string;
          id: string;
          items: Json;
          lead_id: string | null;
          notes: string;
          number: number;
          paid_cents: number;
          property_id: string | null;
          proposal_id: string | null;
          status: string;
          subtotal_cents: number;
          tax_cents: number;
          title: string;
          token: string;
          total_cents: number;
        };
        Insert: {
          created_at?: string;
          customer_address?: string;
          customer_email?: string;
          customer_name: string;
          deposit_cents?: number;
          due_date: string;
          environment?: string;
          expires_at?: string;
          id?: string;
          items: Json;
          lead_id?: string | null;
          notes?: string;
          number?: never;
          paid_cents?: number;
          property_id?: string | null;
          proposal_id?: string | null;
          status?: string;
          subtotal_cents: number;
          tax_cents?: number;
          title: string;
          token?: string;
          total_cents: number;
        };
        Update: {
          created_at?: string;
          customer_address?: string;
          customer_email?: string;
          customer_name?: string;
          deposit_cents?: number;
          due_date?: string;
          environment?: string;
          expires_at?: string;
          id?: string;
          items?: Json;
          lead_id?: string | null;
          notes?: string;
          number?: never;
          paid_cents?: number;
          property_id?: string | null;
          proposal_id?: string | null;
          status?: string;
          subtotal_cents?: number;
          tax_cents?: number;
          title?: string;
          token?: string;
          total_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "crm_invoices_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_invoices_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "crm_properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crm_invoices_proposal_id_fkey";
            columns: ["proposal_id"];
            isOneToOne: false;
            referencedRelation: "proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_properties: {
        Row: {
          address: string;
          created_at: string;
          customer_id: string;
          id: string;
          label: string;
          notes: string;
        };
        Insert: {
          address: string;
          created_at?: string;
          customer_id: string;
          id?: string;
          label?: string;
          notes?: string;
        };
        Update: {
          address?: string;
          created_at?: string;
          customer_id?: string;
          id?: string;
          label?: string;
          notes?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_properties_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "crm_customers";
            referencedColumns: ["id"];
          },
        ];
      };
      crm_tasks: {
        Row: {
          completed_at: string | null;
          created_at: string;
          due_at: string;
          id: string;
          lead_id: string | null;
          title: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          due_at: string;
          id?: string;
          lead_id?: string | null;
          title: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          due_at?: string;
          id?: string;
          lead_id?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "crm_tasks_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      instant_roof_rates: {
        Row: {
          category: string;
          enabled: boolean;
          high_cents: number;
          low_cents: number;
        };
        Insert: {
          category: string;
          enabled?: boolean;
          high_cents: number;
          low_cents: number;
        };
        Update: {
          category?: string;
          enabled?: boolean;
          high_cents?: number;
          low_cents?: number;
        };
        Relationships: [];
      };
      invoice_checkouts: {
        Row: {
          amount_cents: number;
          created_at: string;
          environment: string;
          expires_at: string;
          id: string;
          invoice_id: string;
          session_id: string | null;
          status: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          environment: string;
          expires_at?: string;
          id?: string;
          invoice_id: string;
          session_id?: string | null;
          status?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          environment?: string;
          expires_at?: string;
          id?: string;
          invoice_id?: string;
          session_id?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_checkouts_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "crm_invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_payments: {
        Row: {
          amount_cents: number;
          created_at: string;
          environment: string;
          id: string;
          invoice_id: string;
          method: string;
          provider_event_id: string | null;
          received_at: string;
          reference: string;
        };
        Insert: {
          amount_cents: number;
          created_at?: string;
          environment?: string;
          id?: string;
          invoice_id: string;
          method: string;
          provider_event_id?: string | null;
          received_at?: string;
          reference?: string;
        };
        Update: {
          amount_cents?: number;
          created_at?: string;
          environment?: string;
          id?: string;
          invoice_id?: string;
          method?: string;
          provider_event_id?: string | null;
          received_at?: string;
          reference?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "crm_invoices";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_project_links: {
        Row: {
          created_at: string;
          invoice_id: string;
          job_id: string;
        };
        Insert: {
          created_at?: string;
          invoice_id: string;
          job_id: string;
        };
        Update: {
          created_at?: string;
          invoice_id?: string;
          job_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_project_links_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: true;
            referencedRelation: "crm_invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoice_project_links_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "roof_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_change_orders: {
        Row: {
          amount_cents: number;
          approved_at: string | null;
          approved_by: string | null;
          created_at: string;
          days_added: number;
          id: string;
          job_id: string;
          scope: string;
          status: string;
          title: string;
        };
        Insert: {
          amount_cents?: number;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          days_added?: number;
          id?: string;
          job_id: string;
          scope: string;
          status?: string;
          title: string;
        };
        Update: {
          amount_cents?: number;
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string;
          days_added?: number;
          id?: string;
          job_id?: string;
          scope?: string;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_change_orders_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "roof_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      lead_messages: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          lead_id: string;
          sender: string;
        };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          lead_id: string;
          sender: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          lead_id?: string;
          sender?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lead_messages_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
        ];
      };
      leads: {
        Row: {
          address: string | null;
          chat_token: string;
          created_at: string;
          customer_id: string | null;
          email: string | null;
          id: string;
          last_message_at: string;
          message: string | null;
          name: string;
          notes: string | null;
          page: string | null;
          phone: string | null;
          pipeline_stage: string;
          qualification: Json | null;
          service: string | null;
          source: Database["public"]["Enums"]["lead_source"];
          status: Database["public"]["Enums"]["lead_status"];
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          chat_token?: string;
          created_at?: string;
          customer_id?: string | null;
          email?: string | null;
          id?: string;
          last_message_at?: string;
          message?: string | null;
          name: string;
          notes?: string | null;
          page?: string | null;
          phone?: string | null;
          pipeline_stage?: string;
          qualification?: Json | null;
          service?: string | null;
          source?: Database["public"]["Enums"]["lead_source"];
          status?: Database["public"]["Enums"]["lead_status"];
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          chat_token?: string;
          created_at?: string;
          customer_id?: string | null;
          email?: string | null;
          id?: string;
          last_message_at?: string;
          message?: string | null;
          name?: string;
          notes?: string | null;
          page?: string | null;
          phone?: string | null;
          pipeline_stage?: string;
          qualification?: Json | null;
          service?: string | null;
          source?: Database["public"]["Enums"]["lead_source"];
          status?: Database["public"]["Enums"]["lead_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "crm_customers";
            referencedColumns: ["id"];
          },
        ];
      };
      proposal_shares: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          proposal_id: string;
          revoked_at: string | null;
          signature_data: string | null;
          signed_at: string | null;
          signed_name: string | null;
          token: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          proposal_id: string;
          revoked_at?: string | null;
          signature_data?: string | null;
          signed_at?: string | null;
          signed_name?: string | null;
          token?: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          proposal_id?: string;
          revoked_at?: string | null;
          signature_data?: string | null;
          signed_at?: string | null;
          signed_name?: string | null;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "proposal_shares_proposal_id_fkey";
            columns: ["proposal_id"];
            isOneToOne: false;
            referencedRelation: "proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      proposals: {
        Row: {
          amount: number | null;
          category: string;
          created_at: string;
          drawing_id: string | null;
          file_path: string | null;
          id: string;
          is_template: boolean;
          lead_id: string | null;
          property_id: string | null;
          scope: string;
          terms: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          amount?: number | null;
          category: string;
          created_at?: string;
          drawing_id?: string | null;
          file_path?: string | null;
          id?: string;
          is_template?: boolean;
          lead_id?: string | null;
          property_id?: string | null;
          scope?: string;
          terms?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          amount?: number | null;
          category?: string;
          created_at?: string;
          drawing_id?: string | null;
          file_path?: string | null;
          id?: string;
          is_template?: boolean;
          lead_id?: string | null;
          property_id?: string | null;
          scope?: string;
          terms?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "proposals_drawing_id_fkey";
            columns: ["drawing_id"];
            isOneToOne: false;
            referencedRelation: "roof_drawings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proposals_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proposals_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "crm_properties";
            referencedColumns: ["id"];
          },
        ];
      };
      roof_cost_catalog: {
        Row: {
          category: string;
          created_at: string;
          id: string;
          item: string;
          system: string;
          unit: string;
          unit_cents: number;
        };
        Insert: {
          category: string;
          created_at?: string;
          id?: string;
          item: string;
          system: string;
          unit?: string;
          unit_cents?: number;
        };
        Update: {
          category?: string;
          created_at?: string;
          id?: string;
          item?: string;
          system?: string;
          unit?: string;
          unit_cents?: number;
        };
        Relationships: [];
      };
      roof_drawings: {
        Row: {
          created_at: string;
          geometry: Json;
          id: string;
          measurements: Json;
          media: Json;
          parent_id: string | null;
          property_id: string;
          report_order_id: string | null;
          revision: number;
          title: string;
        };
        Insert: {
          created_at?: string;
          geometry: Json;
          id?: string;
          measurements: Json;
          media?: Json;
          parent_id?: string | null;
          property_id: string;
          report_order_id?: string | null;
          revision?: number;
          title: string;
        };
        Update: {
          created_at?: string;
          geometry?: Json;
          id?: string;
          measurements?: Json;
          media?: Json;
          parent_id?: string | null;
          property_id?: string;
          report_order_id?: string | null;
          revision?: number;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "roof_drawings_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "roof_drawings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_drawings_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "crm_properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_drawings_report_order_id_fkey";
            columns: ["report_order_id"];
            isOneToOne: false;
            referencedRelation: "roof_report_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      roof_estimates: {
        Row: {
          approved_option: string | null;
          category: string;
          created_at: string;
          drawing_id: string | null;
          id: string;
          inputs: Json;
          lead_id: string | null;
          options: Json;
          property_id: string | null;
          report_order_id: string | null;
          title: string;
          total_cents: number;
        };
        Insert: {
          approved_option?: string | null;
          category: string;
          created_at?: string;
          drawing_id?: string | null;
          id?: string;
          inputs: Json;
          lead_id?: string | null;
          options?: Json;
          property_id?: string | null;
          report_order_id?: string | null;
          title: string;
          total_cents: number;
        };
        Update: {
          approved_option?: string | null;
          category?: string;
          created_at?: string;
          drawing_id?: string | null;
          id?: string;
          inputs?: Json;
          lead_id?: string | null;
          options?: Json;
          property_id?: string | null;
          report_order_id?: string | null;
          title?: string;
          total_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "roof_estimates_drawing_id_fkey";
            columns: ["drawing_id"];
            isOneToOne: false;
            referencedRelation: "roof_drawings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_estimates_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_estimates_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "crm_properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_estimates_report_order_id_fkey";
            columns: ["report_order_id"];
            isOneToOne: false;
            referencedRelation: "roof_report_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      roof_jobs: {
        Row: {
          assigned_user_ids: string[];
          budget_cents: number;
          checklist: Json;
          created_at: string;
          crew: string;
          drawing_id: string | null;
          estimate_id: string | null;
          id: string;
          inspection_at: string | null;
          lead_id: string | null;
          material_order: Json | null;
          notes: string;
          permit_status: string;
          photos: Json;
          property_id: string | null;
          proposal_id: string | null;
          start_date: string | null;
          status: string;
          title: string;
        };
        Insert: {
          assigned_user_ids?: string[];
          budget_cents?: number;
          checklist?: Json;
          created_at?: string;
          crew?: string;
          drawing_id?: string | null;
          estimate_id?: string | null;
          id?: string;
          inspection_at?: string | null;
          lead_id?: string | null;
          material_order?: Json | null;
          notes?: string;
          permit_status?: string;
          photos?: Json;
          property_id?: string | null;
          proposal_id?: string | null;
          start_date?: string | null;
          status?: string;
          title: string;
        };
        Update: {
          assigned_user_ids?: string[];
          budget_cents?: number;
          checklist?: Json;
          created_at?: string;
          crew?: string;
          drawing_id?: string | null;
          estimate_id?: string | null;
          id?: string;
          inspection_at?: string | null;
          lead_id?: string | null;
          material_order?: Json | null;
          notes?: string;
          permit_status?: string;
          photos?: Json;
          property_id?: string | null;
          proposal_id?: string | null;
          start_date?: string | null;
          status?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "roof_jobs_drawing_id_fkey";
            columns: ["drawing_id"];
            isOneToOne: false;
            referencedRelation: "roof_drawings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_jobs_estimate_id_fkey";
            columns: ["estimate_id"];
            isOneToOne: false;
            referencedRelation: "roof_estimates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_jobs_lead_id_fkey";
            columns: ["lead_id"];
            isOneToOne: false;
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_jobs_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "crm_properties";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_jobs_proposal_id_fkey";
            columns: ["proposal_id"];
            isOneToOne: false;
            referencedRelation: "proposals";
            referencedColumns: ["id"];
          },
        ];
      };
      roof_report_orders: {
        Row: {
          address: string;
          created_at: string;
          customer_email: string;
          customer_id: string;
          customer_phone: string;
          drawing_id: string | null;
          file_path: string | null;
          id: string;
          measurements: Json | null;
          notes: string;
          property_id: string;
          provider: string;
          provider_reference: string;
          reviewed_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          address: string;
          created_at?: string;
          customer_email?: string;
          customer_id: string;
          customer_phone?: string;
          drawing_id?: string | null;
          file_path?: string | null;
          id?: string;
          measurements?: Json | null;
          notes?: string;
          property_id: string;
          provider?: string;
          provider_reference?: string;
          reviewed_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          address?: string;
          created_at?: string;
          customer_email?: string;
          customer_id?: string;
          customer_phone?: string;
          drawing_id?: string | null;
          file_path?: string | null;
          id?: string;
          measurements?: Json | null;
          notes?: string;
          property_id?: string;
          provider?: string;
          provider_reference?: string;
          reviewed_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "roof_report_orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "crm_customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_report_orders_drawing_id_fkey";
            columns: ["drawing_id"];
            isOneToOne: false;
            referencedRelation: "roof_drawings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "roof_report_orders_property_id_fkey";
            columns: ["property_id"];
            isOneToOne: false;
            referencedRelation: "crm_properties";
            referencedColumns: ["id"];
          },
        ];
      };
      site_content: {
        Row: {
          key: string;
          updated_at: string;
          value: string;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value?: string;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      capture_instant_roof_lead: {
        Args: {
          p_category: string;
          p_lead: Json;
          p_qualification: Json;
          p_total: number;
        };
        Returns: string;
      };
      create_roof_report_request:
        | {
            Args: {
              p_address: string;
              p_notes: string;
              p_provider: string;
              p_title: string;
            };
            Returns: string;
          }
        | {
            Args: {
              p_address: string;
              p_customer_email: string;
              p_customer_phone: string;
              p_notes: string;
              p_provider: string;
              p_title: string;
            };
            Returns: string;
          }
        | {
            Args: {
              p_address: string;
              p_customer_id: string;
              p_notes: string;
              p_provider: string;
              p_title: string;
            };
            Returns: string;
          };
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_crm_company_admin: { Args: { _company_id: string }; Returns: boolean };
      is_crm_company_member: { Args: { _company_id: string }; Returns: boolean };
      record_invoice_payment: {
        Args: {
          p_amount_cents: number;
          p_invoice_id: string;
          p_method: string;
          p_received_at: string;
          p_reference: string;
        };
        Returns: string;
      };
      reserve_invoice_checkout: {
        Args: { p_environment: string; p_kind: string; p_token: string };
        Returns: Json;
      };
      save_crm_customer: { Args: { p_customer: Json }; Returns: string };
      save_report_drawing: {
        Args: { p_drawing: Json; p_report: Json; p_report_id: string };
        Returns: string;
      };
      set_invoice_status: {
        Args: { p_invoice_id: string; p_status: string };
        Returns: boolean;
      };
      settle_invoice_checkout: {
        Args: {
          p_amount_cents: number;
          p_environment: string;
          p_session_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      app_role:
        | "admin"
        | "user"
        | "office"
        | "sales"
        | "production_manager"
        | "crew"
        | "accounting";
      lead_source: "callback" | "contact" | "quote" | "chat";
      lead_status: "new" | "contacted" | "estimate_sent" | "won" | "lost";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "office", "sales", "production_manager", "crew", "accounting"],
      lead_source: ["callback", "contact", "quote", "chat"],
      lead_status: ["new", "contacted", "estimate_sent", "won", "lost"],
    },
  },
} as const;
