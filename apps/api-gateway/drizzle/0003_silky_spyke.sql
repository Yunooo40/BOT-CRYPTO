ALTER TABLE "portfolio_positions" ALTER COLUMN "amount" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "portfolio_positions" ALTER COLUMN "cost_basis" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "portfolio_positions" ALTER COLUMN "realized_pnl" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "trade_history" ALTER COLUMN "amount_in" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "trade_history" ALTER COLUMN "amount_out" SET DATA TYPE numeric;