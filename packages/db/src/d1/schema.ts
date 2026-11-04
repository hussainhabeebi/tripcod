import { sqliteTable, text, real, integer, index } from "drizzle-orm/sqlite-core";

// Tables that live in Cloudflare D1 (the primary database).
// SQL: apps/api/d1/airports/schema.sql — keep this file in step with it.

export const airports = sqliteTable("airports", {
  code:        text("code").primaryKey(),
  name:        text("name").notNull(),
  city:        text("city").notNull(),
  country:     text("country").notNull(),
  countryName: text("country_name").notNull(),
  lat:         real("lat"),
  lon:         real("lon"),
  rank:        integer("rank").notNull().default(1),
  keywords:    text("keywords").notNull().default(""),
}, (t) => ({
  cityIdx:    index("airports_city_idx").on(t.city),
  countryIdx: index("airports_country_idx").on(t.country),
}));

export type Airport = typeof airports.$inferSelect;
