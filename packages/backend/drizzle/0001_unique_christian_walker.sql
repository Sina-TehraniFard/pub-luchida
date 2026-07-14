ALTER TABLE "positions" ADD COLUMN "strategy_name" varchar(50) DEFAULT 'SMA_CROSS' NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "exit_type" varchar(20);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "exit_reason" varchar(200);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "mfe_pips" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "mae_pips" numeric(10, 4);