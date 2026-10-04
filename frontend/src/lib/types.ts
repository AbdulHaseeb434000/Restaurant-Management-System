export type Role = "admin" | "manager" | "cashier" | "waiter" | "kitchen" | "storekeeper";
export type OrderType = "dine_in" | "takeaway" | "delivery";

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface AppSettings {
  restaurant_name: string;
  address: string;
  phone: string;
  currency: string;
  tax_rate: number;
  service_charge_rate: number;
  default_delivery_fee: number;
  receipt_footer: string;
}

export interface MenuCategory {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  item_count: number;
}

export interface MenuItem {
  id: number;
  category_id: number;
  category_name: string;
  name: string;
  code: string | null;
  description: string;
  price: number;
  cost_price: number;
  is_available: boolean;
  is_active: boolean;
  available_dine_in: boolean;
  available_takeaway: boolean;
  available_delivery: boolean;
}

export interface Area {
  id: number;
  name: string;
}

export interface DiningTable {
  id: number;
  name: string;
  area_id: number | null;
  area_name: string | null;
  capacity: number;
  status: "available" | "occupied" | "reserved" | "cleaning";
  is_active: boolean;
  open_order_id: number | null;
  open_order_no: string | null;
  open_order_total: number | null;
  open_since: string | null;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  created_at: string;
  order_count: number;
  total_spent: number;
}

export interface OrderItem {
  id: number;
  menu_item_id: number;
  name: string;
  category_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string;
  status: "new" | "sent" | "preparing" | "ready" | "served" | "cancelled";
  kot_no: number | null;
  sent_at: string | null;
  cancel_reason: string;
  created_at: string;
}

export interface Payment {
  id: number;
  method: "cash" | "card" | "online";
  amount: number;
  reference: string;
  created_at: string;
}

export interface Order {
  id: number;
  order_no: string;
  order_type: OrderType;
  status: "open" | "completed" | "cancelled";
  table_id: number | null;
  table_name: string | null;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  guests: number;
  notes: string;
  delivery_status: "pending" | "dispatched" | "delivered" | null;
  rider_name: string;
  subtotal: number;
  discount_type: "amount" | "percent";
  discount_value: number;
  discount_amount: number;
  service_charge: number;
  tax_amount: number;
  delivery_fee: number;
  total: number;
  paid_amount: number;
  balance_due: number;
  cancel_reason: string;
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
  items: OrderItem[];
  payments: Payment[];
}

export interface OrderListItem {
  id: number;
  order_no: string;
  order_type: OrderType;
  status: Order["status"];
  table_name: string | null;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_status: Order["delivery_status"];
  rider_name: string;
  total: number;
  paid_amount: number;
  item_count: number;
  created_by_name: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface KitchenTicket {
  order_id: number;
  order_no: string;
  order_type: OrderType;
  table_name: string | null;
  customer_name: string;
  kot_no: number;
  sent_at: string | null;
  notes: string;
  items: OrderItem[];
}

export interface Unit {
  id: number;
  name: string;
  abbreviation: string;
}

export interface Named {
  id: number;
  name: string;
}

export interface InventoryItem {
  id: number;
  name: string;
  sku: string | null;
  category_id: number | null;
  category_name: string | null;
  unit_id: number;
  unit_name: string;
  reorder_level: number;
  store_qty: number;
  kitchen_qty: number;
  avg_cost: number;
  last_purchase_price: number;
  stock_value: number;
  is_low: boolean;
  is_active: boolean;
}

export interface Supplier {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  is_active: boolean;
  total_purchases: number;
  balance_due: number;
}

export interface Line {
  id: number;
  item_id: number;
  item_name: string;
  unit_name: string;
  quantity: number;
  unit_cost: number;
  line_total: number;
}

export interface Purchase {
  id: number;
  purchase_no: string;
  supplier_id: number;
  supplier_name: string;
  purchase_date: string;
  invoice_no: string;
  notes: string;
  total: number;
  paid_amount: number;
  status: "received" | "cancelled";
  created_by_name: string | null;
  created_at: string;
  items: Line[];
}

export interface StockIssue {
  id: number;
  issue_no: string;
  issue_date: string;
  issued_to: string;
  notes: string;
  total_value: number;
  created_by_name: string | null;
  created_at: string;
  items: Line[];
}

export interface Adjustment {
  id: number;
  adjustment_date: string;
  item_id: number;
  item_name: string;
  unit_name: string;
  location: "store" | "kitchen";
  reason: string;
  quantity: number;
  unit_cost: number;
  value: number;
  notes: string;
  created_by_name: string | null;
  created_at: string;
}

export interface Movement {
  id: number;
  item_id: number;
  item_name: string;
  unit_name: string;
  location: string;
  movement_type: string;
  quantity: number;
  unit_cost: number;
  balance_after: number;
  ref_type: string;
  ref_id: number | null;
  ref_no: string;
  movement_date: string;
  notes: string;
  created_at: string;
}

export interface Expense {
  id: number;
  expense_date: string;
  category_id: number;
  category_name: string;
  amount: number;
  paid_to: string;
  payment_method: string;
  notes: string;
  created_at: string;
}

export interface ReportMeta {
  key: string;
  title: string;
  group: string;
  description: string;
  uses_dates: boolean;
}

export interface ReportColumn {
  key: string;
  label: string;
  type: "text" | "number" | "money" | "percent" | "date" | "datetime" | "qty" | "status";
  total?: boolean;
}

export interface ReportResult extends ReportMeta {
  date_from: string;
  date_to: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number> | null;
  chart: { type: "bar" | "line" | "pie"; x: string; y: string[]; limit?: number; aggregate?: boolean } | null;
}
