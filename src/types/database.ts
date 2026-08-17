// Generated from the live schema via Supabase MCP (generate_typescript_types).
// Regenerate after every migration. Do not edit by hand.
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
      customers: {
        Row: {
          created_at: string
          default_address: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          phone: string
        }
        Insert: {
          created_at?: string
          default_address?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          phone: string
        }
        Update: {
          created_at?: string
          default_address?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          assigned_at: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          nearby_fired_at: string | null
          order_id: string
          org_id: string
          picked_up_at: string | null
          rider_id: string
        }
        Insert: {
          assigned_at?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          nearby_fired_at?: string | null
          order_id: string
          org_id: string
          picked_up_at?: string | null
          rider_id: string
        }
        Update: {
          assigned_at?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          nearby_fired_at?: string | null
          order_id?: string
          org_id?: string
          picked_up_at?: string | null
          rider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_events: {
        Row: {
          actor: Database["public"]["Enums"]["event_actor"]
          created_at: string
          delivery_id: string
          id: string
          org_id: string
          payload: Json
          type: Database["public"]["Enums"]["delivery_event_type"]
        }
        Insert: {
          actor: Database["public"]["Enums"]["event_actor"]
          created_at?: string
          delivery_id: string
          id?: string
          org_id: string
          payload?: Json
          type: Database["public"]["Enums"]["delivery_event_type"]
        }
        Update: {
          actor?: Database["public"]["Enums"]["event_actor"]
          created_at?: string
          delivery_id?: string
          id?: string
          org_id?: string
          payload?: Json
          type?: Database["public"]["Enums"]["delivery_event_type"]
        }
        Relationships: [
          {
            foreignKeyName: "delivery_events_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: string
          order_id: string
          org_id: string
          provider_response: Json | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          template: string
          to_phone: string
        }
        Insert: {
          attempts?: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          order_id: string
          org_id: string
          provider_response?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template: string
          to_phone: string
        }
        Update: {
          attempts?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          id?: string
          order_id?: string
          org_id?: string
          provider_response?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          template?: string
          to_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cod_amount: number | null
          created_at: string
          customer_id: string
          dropoff_address: string
          dropoff_lat: number | null
          dropoff_lng: number | null
          id: string
          notes: string | null
          org_id: string
          reference: string | null
          status: Database["public"]["Enums"]["order_status"]
          tracking_token: string
        }
        Insert: {
          cod_amount?: number | null
          created_at?: string
          customer_id: string
          dropoff_address: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          id?: string
          notes?: string | null
          org_id: string
          reference?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tracking_token: string
        }
        Update: {
          cod_amount?: number | null
          created_at?: string
          customer_id?: string
          dropoff_address?: string
          dropoff_lat?: number | null
          dropoff_lng?: number | null
          id?: string
          notes?: string | null
          org_id?: string
          reference?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          tracking_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
          sms_config: Json
          webhook_secret_vault_id: string | null
          webhook_url: string | null
          whatsapp_config: Json
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          sms_config?: Json
          webhook_secret_vault_id?: string | null
          webhook_url?: string | null
          whatsapp_config?: Json
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
          sms_config?: Json
          webhook_secret_vault_id?: string | null
          webhook_url?: string | null
          whatsapp_config?: Json
        }
        Relationships: []
      }
      pods: {
        Row: {
          captured_at: string
          cod_collected: number | null
          created_at: string
          delivery_id: string
          id: string
          lat: number
          lng: number
          org_id: string
          photo_path: string
          received_at: string
          recipient_name: string | null
          superseded_by: string | null
        }
        Insert: {
          captured_at: string
          cod_collected?: number | null
          created_at?: string
          delivery_id: string
          id?: string
          lat: number
          lng: number
          org_id: string
          photo_path: string
          received_at?: string
          recipient_name?: string | null
          superseded_by?: string | null
        }
        Update: {
          captured_at?: string
          cod_collected?: number | null
          created_at?: string
          delivery_id?: string
          id?: string
          lat?: number
          lng?: number
          org_id?: string
          photo_path?: string
          received_at?: string
          recipient_name?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pods_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pods_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "pods"
            referencedColumns: ["id"]
          },
        ]
      }
      rider_locations: {
        Row: {
          accuracy: number
          captured_at: string
          created_at: string
          delivery_id: string | null
          heading: number | null
          id: string
          lat: number
          lng: number
          org_id: string
          received_at: string
          rider_id: string
          speed: number | null
        }
        Insert: {
          accuracy: number
          captured_at: string
          created_at?: string
          delivery_id?: string | null
          heading?: number | null
          id?: string
          lat: number
          lng: number
          org_id: string
          received_at?: string
          rider_id: string
          speed?: number | null
        }
        Update: {
          accuracy?: number
          captured_at?: string
          created_at?: string
          delivery_id?: string | null
          heading?: number | null
          id?: string
          lat?: number
          lng?: number
          org_id?: string
          received_at?: string
          rider_id?: string
          speed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rider_locations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rider_locations_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      riders: {
        Row: {
          active: boolean
          created_at: string
          id: string
          last_position: Json | null
          name: string
          org_id: string
          phone: string
          status: Database["public"]["Enums"]["rider_status"]
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          last_position?: Json | null
          name: string
          org_id: string
          phone: string
          status?: Database["public"]["Enums"]["rider_status"]
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          last_position?: Json | null
          name?: string
          org_id?: string
          phone?: string
          status?: Database["public"]["Enums"]["rider_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "riders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_outbox: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          next_attempt_at: string
          org_id: string
          payload: Json
          status: Database["public"]["Enums"]["outbox_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          next_attempt_at?: string
          org_id: string
          payload: Json
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          next_attempt_at?: string
          org_id?: string
          payload?: Json
          status?: Database["public"]["Enums"]["outbox_status"]
        }
        Relationships: [
          {
            foreignKeyName: "webhook_outbox_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_rider: {
        Args: { p_order: string; p_rider: string }
        Returns: string
      }
      fire_nearby: {
        Args: { p_delivery: string }
        Returns: boolean
      }
      transition_order: {
        Args: {
          p_order: string
          p_status: Database["public"]["Enums"]["order_status"]
          p_reason?: string
        }
        Returns: undefined
      }
    }
    Enums: {
      delivery_event_type:
        | "assigned"
        | "picked_up"
        | "nearby"
        | "delivered"
        | "failed"
        | "note"
      event_actor: "rider" | "dispatcher" | "system"
      notification_channel: "whatsapp" | "sms"
      notification_status: "queued" | "sent" | "failed"
      order_status:
        | "pending"
        | "assigned"
        | "picked_up"
        | "in_transit"
        | "delivered"
        | "failed"
        | "cancelled"
      org_role: "owner" | "dispatcher" | "admin"
      outbox_status: "queued" | "delivered" | "failed"
      rider_status: "offline" | "available" | "on_delivery"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T]["Update"]
export type Enums<T extends keyof DefaultSchema["Enums"]> =
  DefaultSchema["Enums"][T]
