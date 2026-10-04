# Restaurant Management System

A restaurant management app for dine-in, take-away and delivery. It covers a POS, table management, a kitchen display, menu management, ingredient inventory (purchases and store-to-kitchen issues) and 22 business reports.

**Stack:** FastAPI + SQLAlchemy 2 (Python 3.11), PostgreSQL 16 and Next.js 15 (React 19, TypeScript, Tailwind CSS, Recharts).

---

## Features

### Front of house
| Module | What it does |
|---|---|
| **POS** | Touch-friendly menu grid with category tabs and search. Supports dine-in (table + guests), take-away and delivery (phone lookup auto-fills the saved customer and address). You can hold or save an order, send new items to the kitchen (each send creates a numbered **KOT**), add item notes ("extra spicy"), apply a % or flat discount, transfer to another table, void sent items (full or partial quantity, with a reason), cancel the order, take split payments (cash / card / online) with a change calculator, and print the bill, receipt and KOT. |
| **Tables** | Live floor plan grouped by area. Shows available / occupied / reserved / cleaning, plus the running bill and minutes seated. Tap a free table to start an order, or an occupied one to open it. Managers can add, edit and delete tables and areas. |
| **Orders** | Order history with status, type, date and text filters. Open any order in the POS, reprint receipts, and (managers) reopen completed orders. |
| **Kitchen Display (KDS)** | Auto-refreshing ticket board, one card per KOT. Cards are colour-coded by age (10 / 20 min), item notes are highlighted, and you can move single items or whole tickets through Start → Ready → Served. |
| **Deliveries** | Board with three columns: Pending → Out for delivery (rider assignment) → Delivered today. |
| **Customers** | Directory with order count and lifetime spend. Customers are created automatically from delivery and take-away phone numbers. |

### Back office
| Module | What it does |
|---|---|
| **Menu management** | Categories (sort order, active flag) and items with price, estimated cost, code, description and per-channel availability (dine-in / take-away / delivery). Toggle items out of stock ("86") instantly. |
| **Inventory items** | Ingredients with SKU, category, unit of measure and reorder level. Stock is tracked separately for **store** and **kitchen**, at weighted-average cost. |
| **Purchases (GRN)** | Receive goods from a supplier with multiple lines. This adds to store stock and updates the average cost. Tracks paid / balance due per supplier. A purchase can be cancelled (stock reversed) if its stock has not been issued yet. |
| **Store → Kitchen issue** | Move stock from store to kitchen at average cost. Issuing more than is in store is blocked. |
| **Adjustments / wastage** | Wastage, damage, kitchen consumption (closing count), count corrections and opening stock. |
| **Stock overview & ledger** | Current stock and its value, a low-stock filter, and an immutable movement ledger with running balance. |
| **Suppliers** | Supplier directory with total purchases and outstanding balance. |
| **Expenses** | Operating expenses by category (rent, salaries, utilities, …). Used in the P&L. |
| **Users & roles** | admin, manager, cashier, waiter, kitchen, storekeeper. Every API endpoint and every screen is role-checked. |
| **Settings** | Restaurant name, address and phone for receipts, currency, tax %, dine-in service charge %, default delivery fee and receipt footer. |

### Reports (22)
Each report runs for any date range and has a chart, totals, CSV export and print.

**Sales:** Daily Sales Summary · Sales by Order Type · Item-wise Sales · Category-wise Sales · Hourly Sales (peak hours) · Day-of-Week Sales · Payment Method Summary · Discount Report · Cancelled Orders & Voided Items · Table Performance (covers, avg/cover, seating time) · Staff Sales Performance · Top Customers · Delivery Report (per rider) · Non-Selling Menu Items

**Inventory:** Purchases by Supplier · Item-wise Purchases (min/max/avg price) · Store-to-Kitchen Issues · Current Stock & Valuation · Low Stock / Reorder List (suggested qty & cost) · Wastage & Adjustments

**Finance:** Expenses by Category · Profit & Loss Summary

> Because recipe mapping is not built yet, **food cost = value issued from store to kitchen** in the P&L.

The **dashboard** shows today's sales, average order value, open orders, table occupancy, kitchen queue, active deliveries, low-stock count, a 7-day sales chart, the order-type split, collections and top items.

### Billing rules
```
subtotal        = sum of non-cancelled lines
discount        = % of subtotal or flat amount (capped at subtotal)
service charge  = (subtotal - discount) x service %      (dine-in only)
tax             = (subtotal - discount + service) x tax %
delivery fee    = settings default, editable per order     (delivery only)
total           = subtotal - discount + service + tax + delivery fee
```
An order can only be completed once it is fully paid. Items that have been sent to the kitchen cannot be edited, only voided with a reason, so the cancellation report stays complete.

---

## Quick start (Docker)

```bash
docker compose up --build
```
- App: http://localhost:3111
- API docs (Swagger): http://localhost:8111/docs

On first start the backend creates the tables. It loads demo data (menu, 17 tables, 35 ingredients, 5 suppliers, about 30 days of orders, purchases and issues) into an **empty** database. Set `SEED_DEMO_DATA=false` for a clean install; only the admin user, settings, units and expense categories are created then.

### Demo logins
| Username | Password | Role | Lands on |
|---|---|---|---|
| admin | admin123 | admin | Dashboard |
| manager | manager123 | manager | Dashboard |
| cashier | cashier123 | cashier | POS |
| waiter | waiter123 | waiter | Tables |
| kitchen | kitchen123 | kitchen | Kitchen display |
| store | store123 | storekeeper | Stock overview |

**Change these passwords and set a strong `SECRET_KEY` before going live.**

---

## Local development

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # edit DATABASE_URL / SECRET_KEY / TIMEZONE
createdb restaurant           # PostgreSQL must be running
uvicorn app.main:app --reload --port 8111
```

### Frontend
```bash
cd frontend
npm install
BACKEND_URL=http://localhost:8111 npm run dev    # http://localhost:3111
```
The browser only talks to `/api/*` on the Next.js origin, and Next proxies those calls to FastAPI (`next.config.mjs`), so no CORS setup is needed.

### Tests
```bash
createdb restaurant_test
cd backend && pytest -q
```
The tests cover the full dine-in flow (KOTs, partial and full voids, discounts, table transfer, split payment, reopen), delivery, cancellation, role permissions, purchase → issue → adjustment with weighted-average costing, and a run of every report.

---

## Configuration (backend env vars)
| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://postgres:postgres@localhost:5432/restaurant` | PostgreSQL connection |
| `SECRET_KEY` | `change-me-in-production` | JWT signing key |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | Login session length |
| `TIMEZONE` | `Asia/Karachi` | Business day and hour boundaries for reports and the dashboard |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | First admin (only created when there are no users) |
| `SEED_DEMO_DATA` | `true` | Load demo data into an empty DB |
| `CORS_ORIGINS` | `http://localhost:3111` | Only needed if the API is called cross-origin |

## Project layout
```
backend/
  app/
    main.py          FastAPI app, startup (create tables + seed)
    models.py        SQLAlchemy models
    schemas.py       Pydantic request/response models
    services.py      order totals, stock movements, weighted-average costing
    routers/         auth, settings, menu, tables, customers, orders (+KDS),
                     inventory, expenses, reports (+dashboard)
    seed.py          admin/settings + demo data
  tests/             pytest API tests
frontend/
  src/app/(app)/     authenticated screens (POS, tables, kitchen, inventory, reports, …)
  src/app/print/     printable receipt and KOT (80 mm thermal layout)
  src/components/    app shell, modals, payment dialog, line editor
  src/lib/           API client, auth context, types, formatting
```

## Not included yet (next phases)
- Recipe / BOM mapping with automatic ingredient deduction per sale
- Database migrations (Alembic). Tables are currently created with `create_all`.
- Shift / cash-drawer closing, purchase orders before GRN, multi-branch
