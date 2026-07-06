CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"occurred_at" bigint NOT NULL,
	"correlation_id" text NOT NULL,
	"user_id" text,
	"source" text NOT NULL,
	"outcome" text NOT NULL,
	"subject" text,
	"detail" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_correlation_id_idx" ON "audit_log" USING btree ("correlation_id");