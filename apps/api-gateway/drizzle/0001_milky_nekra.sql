CREATE TABLE "portfolio_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"token" text NOT NULL,
	"simulated" boolean NOT NULL,
	"amount" bigint NOT NULL,
	"cost_basis" bigint NOT NULL,
	"realized_pnl" bigint NOT NULL,
	"opened_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_history" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"side" text NOT NULL,
	"token" text NOT NULL,
	"amount_in" bigint NOT NULL,
	"amount_in_decimals" integer NOT NULL,
	"amount_out" bigint NOT NULL,
	"amount_out_decimals" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"simulated" boolean NOT NULL,
	"occurred_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trade_history_occurred_at_idx" ON "trade_history" USING btree ("occurred_at");