// Read-only: the production D1 order for a TripJack booking through the deployed
// display code (publicOrder), plus its Neon wallet ledger. Metadata only (public repo).
import { execFileSync } from "node:child_process";
import { createDb } from "@tripcod/db";
import { walletTransactions } from "@tripcod/db/schema";
import { or, eq, like } from "drizzle-orm";
import { rowToOrder } from "./src/lib/hotel-order-store.js";
import { publicOrder } from "./src/lib/hotel-orders.js";

const booking = process.argv[2];
if (!/^[A-Z0-9]{8,40}$/.test(booking)) throw new Error("bad booking id");
const out = execFileSync("npx", ["-y", "wrangler@4.86.0", "d1", "execute", "tripcod-hotels", "--remote", "--json", "--command",
  `SELECT * FROM hotel_bookings WHERE supplier_booking_id = '${booking}'`], { encoding: "utf8" });
const row = JSON.parse(out)[0].results[0];
if (!row) throw new Error("order not found");
const order = rowToOrder(row);
const view = publicOrder(order);
console.log("ORDER", JSON.stringify({ booking, stored: { status: order.status, payment: order.paymentStatus, gateway: order.paymentGateway, supplier: order.supplierStatus },
  shown: { status: view.status, statusText: view.statusText, pending: view.pending, payment: view.payment.status, payable: view.payment.payable, canCancel: view.canCancel } }));
const db = createDb(process.env.DATABASE_URL!);
const txs = await db.select({ type: walletTransactions.type, amount: walletTransactions.amount, paymentId: walletTransactions.paymentId })
  .from(walletTransactions).where(or(eq(walletTransactions.bookingId, order.id), like(walletTransactions.paymentId, `hotel_%${order.id}%`)));
const debits = txs.filter((t) => t.type === "BOOKING_DEBIT"), refunds = txs.filter((t) => t.type === "REFUND_CREDIT");
console.log("LEDGER", JSON.stringify({ debits: debits.map((t) => t.amount), refunds: refunds.map((t) => t.amount) }));
const problems = [];
if (debits.length !== 1) problems.push(`expected 1 debit, found ${debits.length}`);
if (refunds.length) problems.push(`unexpected refund on a confirmed booking: ${refunds.length}`);
if (order.supplierStatus === "SUCCESS" && (view.status !== "CONFIRMED" || view.statusText !== "Confirmed")) problems.push(`shown as ${view.statusText}`);
console.log(problems.length ? `RESULT PROBLEMS ${problems.join("; ")}` : "RESULT OK");
process.exit(problems.length ? 1 : 0);
