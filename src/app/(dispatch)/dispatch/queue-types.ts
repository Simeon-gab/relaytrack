import type { Enums } from "@/types/database";

/** Shape the dispatch queue passes from server page to client components. */
export interface QueueOrder {
  id: string;
  reference: string | null;
  status: Enums<"order_status">;
  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  cod_amount: number | null;
  created_at: string;
  customers: { name: string; phone: string } | null;
  deliveries: {
    id: string;
    riders: { id: string; name: string } | null;
  } | null;
}

export interface RiderOption {
  id: string;
  name: string;
}

export interface CustomerOption {
  name: string;
  phone: string;
  default_address: string | null;
}
