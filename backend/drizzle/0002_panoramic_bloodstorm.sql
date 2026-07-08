ALTER TABLE `request_logs` ADD `prompt_tokens` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `completion_tokens` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `total_tokens` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `request_logs` ADD `estimated_cost` real DEFAULT 0;