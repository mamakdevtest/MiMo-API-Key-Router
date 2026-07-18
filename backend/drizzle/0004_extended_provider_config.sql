-- Extended provider configuration
-- Adds documentation/auth/endpoint/custom-header/timeout/health/capability columns
-- to the providers table for OrcaRouter and custom OpenAI-compatible providers.

ALTER TABLE `providers` ADD `documentation_url` text;
--> statement-breakpoint
ALTER TABLE `providers` ADD `auth_header` text DEFAULT 'Authorization' NOT NULL;
--> statement-breakpoint
ALTER TABLE `providers` ADD `auth_prefix` text DEFAULT 'Bearer ' NOT NULL;
--> statement-breakpoint
ALTER TABLE `providers` ADD `models_endpoint` text DEFAULT '/models' NOT NULL;
--> statement-breakpoint
ALTER TABLE `providers` ADD `chat_completions_endpoint` text DEFAULT '/chat/completions' NOT NULL;
--> statement-breakpoint
ALTER TABLE `providers` ADD `embeddings_endpoint` text;
--> statement-breakpoint
ALTER TABLE `providers` ADD `custom_headers_json` text;
--> statement-breakpoint
ALTER TABLE `providers` ADD `timeout_ms` integer;
--> statement-breakpoint
ALTER TABLE `providers` ADD `health_check_endpoint` text;
--> statement-breakpoint
ALTER TABLE `providers` ADD `capabilities_json` text;
