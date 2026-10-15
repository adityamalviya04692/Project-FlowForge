// Generates small, deliberately messy sample datasets for the demo pipeline:
//   public/sample/orders.csv     (duplicate versions, cancelled orders, bad quantities, missing customers)
//   public/sample/customers.csv
//   public/sample/products.csv
// Seeded, so the demo is reproducible.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample');

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261022);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const weighted = (pairs) => {
  let r = rand() * pairs.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[0][0];
};
const pad = (n, w) => String(n).padStart(w, '0');
const day = (start, offset) => new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
const csv = (header, rows) => [header.join(','), ...rows.map((r) => r.map((v) => (v == null ? '' : /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(','))].join('\n') + '\n';

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Isha', 'Vihaan', 'Ananya', 'Rohan', 'Meera', 'Arjun', 'Sara', 'Dev', 'Nisha', 'Kiran', 'Tara', 'Neel', 'Riya'];
const LAST = ['Sharma', 'Iyer', 'Khan', 'Patel', 'Reddy', 'Das', 'Mehta', 'Nair', 'Gupta', 'Bose', 'Singh', 'Rao'];
const CITIES = ['Mumbai', 'Delhi', 'Bengaluru', 'Hyderabad', 'Pune', 'Chennai', 'Kolkata', 'Ahmedabad'];
const CATEGORIES = { Electronics: [900, 4200], Fashion: [300, 1800], Home: [400, 2600], Beauty: [150, 900], Books: [120, 600], Sports: [350, 2400] };

const customers = Array.from({ length: 600 }, (_, i) => [
  `C${pad(i + 1, 4)}`,
  `${pick(FIRST)} ${pick(LAST)}`,
  pick(CITIES),
  weighted([['consumer', 75], ['business', 18], ['vip', 7]]),
  day(Date.UTC(2022, 0, 1), Math.floor(rand() * 1100)),
]);

const products = [];
for (const [cat, [lo, hi]] of Object.entries(CATEGORIES)) {
  for (let i = 1; i <= 12; i++) products.push([`P${pad(products.length + 1, 3)}`, `${cat} item ${i}`, cat, Math.round(lo + rand() * (hi - lo))]);
}

const orders = [];
for (let i = 0; i < 3000; i++) {
  const p = pick(products);
  const date = day(Date.UTC(2025, 6, 1), Math.floor(rand() * 92));
  const status = weighted([['completed', 80], ['cancelled', 8], ['returned', 5], ['pending', 7]]);
  let quantity = 1 + Math.floor(rand() * 4);
  if (rand() < 0.01) quantity = rand() < 0.5 ? 0 : -quantity; // bad quantities
  const customer = rand() < 0.012 ? null : pick(customers)[0]; // missing customer ids
  const unitPrice = Math.round(Number(p[3]) * (0.85 + rand() * 0.3) * 100) / 100;
  orders.push([`O${pad(i + 1, 5)}`, customer, p[0], quantity, unitPrice.toFixed(2), status, weighted([['web', 55], ['app', 35], ['store', 10]]), date, `${date} ${pad(8 + Math.floor(rand() * 12), 2)}:${pad(Math.floor(rand() * 60), 2)}:00`]);
}
// Late-arriving updates: the same order appears again with a newer updated_at and a new status.
for (let i = 0; i < 200; i++) {
  const o = [...pick(orders)];
  o[5] = weighted([['completed', 60], ['returned', 40]]);
  o[8] = `${o[7]} 23:${pad(Math.floor(rand() * 60), 2)}:00`;
  orders.push(o);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'orders.csv'), csv(['order_id', 'customer_id', 'product_id', 'quantity', 'unit_price', 'status', 'channel', 'order_date', 'updated_at'], orders));
writeFileSync(join(OUT, 'customers.csv'), csv(['customer_id', 'name', 'city', 'segment', 'signup_date'], customers));
writeFileSync(join(OUT, 'products.csv'), csv(['product_id', 'product_name', 'category', 'price'], products));
console.log(`orders ${orders.length}, customers ${customers.length}, products ${products.length}`);
