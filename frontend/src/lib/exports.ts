/** Excel column layouts for every screen that can be exported. */
import type { XSheet } from "./excel";
import { ORDER_TYPE_LABEL, titleCase } from "./format";
import type {
  Adjustment,
  Customer,
  DiningTable,
  Expense,
  InventoryItem,
  MenuItem,
  Movement,
  OrderListItem,
  Purchase,
  ReportResult,
  StockIssue,
  Supplier,
  User,
} from "./types";

const yesNo = (v: boolean) => (v ? "Yes" : "No");

export const ordersSheets = (rows: OrderListItem[]): XSheet<OrderListItem>[] => [
  {
    name: "Orders",
    rows,
    columns: [
      { header: "Order #", value: (o) => o.order_no },
      { header: "Date/Time", value: (o) => o.created_at, type: "datetime" },
      { header: "Type", value: (o) => ORDER_TYPE_LABEL[o.order_type] },
      { header: "Status", value: (o) => titleCase(o.status) },
      { header: "Table", value: (o) => o.table_name },
      { header: "Customer", value: (o) => o.customer_name },
      { header: "Phone", value: (o) => o.customer_phone },
      { header: "Delivery address", value: (o) => o.delivery_address },
      { header: "Delivery status", value: (o) => (o.delivery_status ? titleCase(o.delivery_status) : "") },
      { header: "Rider", value: (o) => o.rider_name },
      { header: "Items", value: (o) => o.item_count, type: "number" },
      { header: "Total", value: (o) => o.total, type: "money" },
      { header: "Paid", value: (o) => o.paid_amount, type: "money" },
      { header: "Taken by", value: (o) => o.created_by_name },
      { header: "Closed at", value: (o) => o.completed_at, type: "datetime" },
    ],
  },
];

export const customersSheets = (rows: Customer[]): XSheet<Customer>[] => [
  {
    name: "Customers",
    rows,
    columns: [
      { header: "Name", value: (c) => c.name },
      { header: "Phone", value: (c) => c.phone },
      { header: "Email", value: (c) => c.email },
      { header: "Address", value: (c) => c.address },
      { header: "Orders", value: (c) => c.order_count, type: "number" },
      { header: "Total spent", value: (c) => c.total_spent, type: "money" },
      { header: "Customer since", value: (c) => c.created_at, type: "date" },
      { header: "Notes", value: (c) => c.notes },
    ],
  },
];

export const menuSheets = (rows: MenuItem[]): XSheet<MenuItem>[] => [
  {
    name: "Menu",
    rows,
    columns: [
      { header: "Code", value: (m) => m.code },
      { header: "Item", value: (m) => m.name },
      { header: "Category", value: (m) => m.category_name },
      { header: "Price", value: (m) => m.price, type: "money" },
      { header: "Est. cost", value: (m) => m.cost_price, type: "money" },
      { header: "Margin %", value: (m) => (m.price ? ((m.price - m.cost_price) * 100) / m.price : 0), type: "percent" },
      { header: "Dine-in", value: (m) => yesNo(m.available_dine_in) },
      { header: "Take-away", value: (m) => yesNo(m.available_takeaway) },
      { header: "Delivery", value: (m) => yesNo(m.available_delivery) },
      { header: "Available now", value: (m) => yesNo(m.is_available) },
      { header: "Active", value: (m) => yesNo(m.is_active) },
      { header: "Description", value: (m) => m.description },
    ],
  },
];

export const tablesSheets = (rows: DiningTable[]): XSheet<DiningTable>[] => [
  {
    name: "Tables",
    rows,
    columns: [
      { header: "Table", value: (t) => t.name },
      { header: "Area", value: (t) => t.area_name },
      { header: "Seats", value: (t) => t.capacity, type: "number" },
      { header: "Status", value: (t) => titleCase(t.status) },
      { header: "Open order", value: (t) => t.open_order_no },
      { header: "Running bill", value: (t) => t.open_order_total, type: "money" },
      { header: "Seated since", value: (t) => t.open_since, type: "datetime" },
    ],
  },
];

export const usersSheets = (rows: User[]): XSheet<User>[] => [
  {
    name: "Users",
    rows,
    columns: [
      { header: "Username", value: (u) => u.username },
      { header: "Full name", value: (u) => u.full_name },
      { header: "Role", value: (u) => titleCase(u.role) },
      { header: "Active", value: (u) => yesNo(u.is_active) },
      { header: "Created", value: (u) => u.created_at, type: "date" },
    ],
  },
];

export const expensesSheets = (rows: Expense[]): XSheet<Expense>[] => [
  {
    name: "Expenses",
    rows,
    columns: [
      { header: "Date", value: (e) => e.expense_date, type: "date" },
      { header: "Category", value: (e) => e.category_name },
      { header: "Paid to", value: (e) => e.paid_to },
      { header: "Method", value: (e) => titleCase(e.payment_method) },
      { header: "Amount", value: (e) => e.amount, type: "money" },
      { header: "Notes", value: (e) => e.notes },
    ],
  },
];

export const stockSheets = (rows: InventoryItem[]): XSheet<InventoryItem>[] => [
  {
    name: "Stock",
    rows,
    columns: [
      { header: "SKU", value: (i) => i.sku },
      { header: "Item", value: (i) => i.name },
      { header: "Category", value: (i) => i.category_name },
      { header: "Unit", value: (i) => i.unit_name },
      { header: "Store qty", value: (i) => i.store_qty, type: "qty" },
      { header: "Kitchen qty", value: (i) => i.kitchen_qty, type: "qty" },
      { header: "Reorder level", value: (i) => i.reorder_level, type: "qty" },
      { header: "Avg cost", value: (i) => i.avg_cost, type: "money" },
      { header: "Last purchase price", value: (i) => i.last_purchase_price, type: "money" },
      { header: "Stock value", value: (i) => i.stock_value, type: "money" },
      { header: "Low stock", value: (i) => yesNo(i.is_low) },
      { header: "Active", value: (i) => yesNo(i.is_active) },
    ],
  },
];

export const suppliersSheets = (rows: Supplier[]): XSheet<Supplier>[] => [
  {
    name: "Suppliers",
    rows,
    columns: [
      { header: "Name", value: (s) => s.name },
      { header: "Contact", value: (s) => s.contact_person },
      { header: "Phone", value: (s) => s.phone },
      { header: "Email", value: (s) => s.email },
      { header: "Address", value: (s) => s.address },
      { header: "Total purchases", value: (s) => s.total_purchases, type: "money" },
      { header: "Balance due", value: (s) => s.balance_due, type: "money" },
      { header: "Active", value: (s) => yesNo(s.is_active) },
    ],
  },
];

type PurchaseLine = Purchase["items"][number] & { doc: Purchase };

export const purchasesSheets = (rows: Purchase[]): XSheet<Purchase | PurchaseLine>[] => [
  {
    name: "Purchases",
    rows,
    columns: [
      { header: "GRN #", value: (p) => (p as Purchase).purchase_no },
      { header: "Date", value: (p) => (p as Purchase).purchase_date, type: "date" },
      { header: "Supplier", value: (p) => (p as Purchase).supplier_name },
      { header: "Invoice #", value: (p) => (p as Purchase).invoice_no },
      { header: "Lines", value: (p) => (p as Purchase).items.length, type: "number" },
      { header: "Total", value: (p) => (p as Purchase).total, type: "money" },
      { header: "Paid", value: (p) => (p as Purchase).paid_amount, type: "money" },
      { header: "Balance", value: (p) => (p as Purchase).total - (p as Purchase).paid_amount, type: "money" },
      { header: "Status", value: (p) => titleCase((p as Purchase).status) },
      { header: "Received by", value: (p) => (p as Purchase).created_by_name },
      { header: "Notes", value: (p) => (p as Purchase).notes },
    ],
  },
  {
    name: "Purchase lines",
    rows: rows.flatMap((p) => p.items.map((l) => ({ ...l, doc: p }))),
    columns: [
      { header: "GRN #", value: (l) => (l as PurchaseLine).doc.purchase_no },
      { header: "Date", value: (l) => (l as PurchaseLine).doc.purchase_date, type: "date" },
      { header: "Supplier", value: (l) => (l as PurchaseLine).doc.supplier_name },
      { header: "Item", value: (l) => (l as PurchaseLine).item_name },
      { header: "Unit", value: (l) => (l as PurchaseLine).unit_name },
      { header: "Qty", value: (l) => (l as PurchaseLine).quantity, type: "qty" },
      { header: "Unit cost", value: (l) => (l as PurchaseLine).unit_cost, type: "money" },
      { header: "Amount", value: (l) => (l as PurchaseLine).line_total, type: "money" },
      { header: "Status", value: (l) => titleCase((l as PurchaseLine).doc.status) },
    ],
  },
];

type IssueLine = StockIssue["items"][number] & { doc: StockIssue };

export const issuesSheets = (rows: StockIssue[]): XSheet<StockIssue | IssueLine>[] => [
  {
    name: "Issues",
    rows,
    columns: [
      { header: "Issue #", value: (i) => (i as StockIssue).issue_no },
      { header: "Date", value: (i) => (i as StockIssue).issue_date, type: "date" },
      { header: "Issued to", value: (i) => (i as StockIssue).issued_to },
      { header: "Lines", value: (i) => (i as StockIssue).items.length, type: "number" },
      { header: "Value", value: (i) => (i as StockIssue).total_value, type: "money" },
      { header: "By", value: (i) => (i as StockIssue).created_by_name },
      { header: "Notes", value: (i) => (i as StockIssue).notes },
    ],
  },
  {
    name: "Issue lines",
    rows: rows.flatMap((i) => i.items.map((l) => ({ ...l, doc: i }))),
    columns: [
      { header: "Issue #", value: (l) => (l as IssueLine).doc.issue_no },
      { header: "Date", value: (l) => (l as IssueLine).doc.issue_date, type: "date" },
      { header: "Item", value: (l) => (l as IssueLine).item_name },
      { header: "Unit", value: (l) => (l as IssueLine).unit_name },
      { header: "Qty", value: (l) => (l as IssueLine).quantity, type: "qty" },
      { header: "Unit cost", value: (l) => (l as IssueLine).unit_cost, type: "money" },
      { header: "Value", value: (l) => (l as IssueLine).line_total, type: "money" },
    ],
  },
];

export const adjustmentsSheets = (rows: Adjustment[]): XSheet<Adjustment>[] => [
  {
    name: "Adjustments",
    rows,
    columns: [
      { header: "Date", value: (a) => a.adjustment_date, type: "date" },
      { header: "Item", value: (a) => a.item_name },
      { header: "Location", value: (a) => titleCase(a.location) },
      { header: "Reason", value: (a) => titleCase(a.reason) },
      { header: "Qty", value: (a) => a.quantity, type: "qty" },
      { header: "Unit", value: (a) => a.unit_name },
      { header: "Unit cost", value: (a) => a.unit_cost, type: "money" },
      { header: "Value", value: (a) => a.value, type: "money" },
      { header: "By", value: (a) => a.created_by_name },
      { header: "Notes", value: (a) => a.notes },
    ],
  },
];

export const ledgerSheets = (rows: Movement[]): XSheet<Movement>[] => [
  {
    name: "Stock ledger",
    rows,
    columns: [
      { header: "Date", value: (m) => m.movement_date, type: "date" },
      { header: "Item", value: (m) => m.item_name },
      { header: "Location", value: (m) => titleCase(m.location) },
      { header: "Type", value: (m) => titleCase(m.movement_type) },
      { header: "Reference", value: (m) => m.ref_no },
      { header: "Qty", value: (m) => m.quantity, type: "qty" },
      { header: "Unit", value: (m) => m.unit_name },
      { header: "Unit cost", value: (m) => m.unit_cost, type: "money" },
      { header: "Balance after", value: (m) => m.balance_after, type: "qty" },
      { header: "Notes", value: (m) => m.notes },
    ],
  },
];

type Row = ReportResult["rows"][number];

export const reportSheets = (r: ReportResult): XSheet<Row>[] => {
  const rows = r.totals ? [...r.rows, { ...r.totals, [r.columns[0].key]: "TOTAL" } as Row] : r.rows;
  return [
    {
      name: r.title,
      rows,
      columns: r.columns.map((c) => ({
        header: c.label,
        value: (row: Row) => row[c.key],
        type: c.type === "status" ? "text" : c.type,
      })),
    },
  ];
};
