CREATE TYPE "public"."buy_sell_type" AS ENUM('BUY', 'SELL');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "position_entry_snapshots" (
	"position_id" varchar(50) PRIMARY KEY NOT NULL,
	"conviction_score" numeric(5, 4),
	"sma_spread_atr_ratio" numeric(10, 6),
	"adx" numeric(10, 4),
	"atr_pips" numeric(10, 4),
	"rsi" numeric(10, 4),
	"spread_pips" numeric(6, 4),
	"trend_alignment" smallint,
	"entry_hour" smallint,
	"entry_day_of_week" smallint
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"currency_pair" varchar(7) NOT NULL,
	"buy_sell" "buy_sell_type" NOT NULL,
	"lot" numeric(10, 2) NOT NULL,
	"entry_price" numeric(12, 6) NOT NULL,
	"exit_price" numeric(12, 6),
	"profit_loss" numeric(12, 2),
	"status" "position_status" DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "position_entry_snapshots" ADD CONSTRAINT "position_entry_snapshots_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;