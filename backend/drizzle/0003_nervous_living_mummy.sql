-- Multi-Provider AI Gateway migration
-- Adds provider system tables and extends request_logs

-- ── New tables ──────────────────────────────────────────────

CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`base_url` text NOT NULL,
	`enabled` integer NOT NULL DEFAULT true,
	`priority` integer NOT NULL DEFAULT 0,
	`routing_weight` integer NOT NULL DEFAULT 1,
	`health_status` text NOT NULL DEFAULT 'unknown',
	`health_message` text,
	`config_json` text,
	`billing_mode` text NOT NULL DEFAULT 'unknown',
	`last_health_check_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_slug_unique` ON `providers` (`slug`);
--> statement-breakpoint

CREATE TABLE `provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL REFERENCES `providers`(`id`) ON DELETE CASCADE,
	`name` text NOT NULL,
	`encrypted_secret` text NOT NULL,
	`masked_secret` text NOT NULL,
	`priority` integer NOT NULL DEFAULT 0,
	`status` text NOT NULL DEFAULT 'active',
	`cooldown_until` integer,
	`failure_count` integer NOT NULL DEFAULT 0,
	`success_count` integer NOT NULL DEFAULT 0,
	`last_used_at` integer,
	`last_success_at` integer,
	`last_error_at` integer,
	`last_error_code` integer,
	`last_error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint

CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL REFERENCES `providers`(`id`) ON DELETE CASCADE,
	`upstream_model_id` text NOT NULL,
	`display_name` text,
	`model_class` text,
	`status` text NOT NULL DEFAULT 'active',
	`availability_tier` text,
	`context_length` integer,
	`effective_context_length` integer,
	`max_completion_tokens` integer,
	`concurrency_cost` integer NOT NULL DEFAULT 1,
	`is_gated` integer NOT NULL DEFAULT false,
	`available_on_current_plan` integer NOT NULL DEFAULT true,
	`supports_chat` integer NOT NULL DEFAULT true,
	`supports_text_completion` integer NOT NULL DEFAULT false,
	`supports_tools` integer NOT NULL DEFAULT false,
	`supports_vision` integer NOT NULL DEFAULT false,
	`supports_embeddings` integer NOT NULL DEFAULT false,
	`input_modalities_json` text,
	`output_modalities_json` text,
	`tasks_json` text,
	`features_json` text,
	`pricing_prompt` text,
	`pricing_completion` text,
	`pricing_image` text,
	`pricing_request` text,
	`metadata_json` text,
	`last_synced_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint

CREATE TABLE `model_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`public_model_id` text NOT NULL,
	`display_name` text,
	`description` text,
	`route_kind` text NOT NULL DEFAULT 'chat',
	`strategy` text NOT NULL DEFAULT 'priority_failover',
	`enabled` integer NOT NULL DEFAULT true,
	`is_public` integer NOT NULL DEFAULT true,
	`allowed_protocols_json` text,
	`required_capabilities_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_routes_public_model_id_unique` ON `model_routes` (`public_model_id`);
--> statement-breakpoint

CREATE TABLE `model_route_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`route_id` text NOT NULL REFERENCES `model_routes`(`id`) ON DELETE CASCADE,
	`provider_id` text NOT NULL REFERENCES `providers`(`id`) ON DELETE CASCADE,
	`provider_model_id` text NOT NULL REFERENCES `provider_models`(`id`) ON DELETE CASCADE,
	`priority` integer NOT NULL DEFAULT 0,
	`weight` integer NOT NULL DEFAULT 1,
	`enabled` integer NOT NULL DEFAULT true,
	`timeout_override_ms` integer,
	`max_attempts_override` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint

CREATE TABLE `request_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`request_log_id` text NOT NULL REFERENCES `request_logs`(`id`) ON DELETE CASCADE,
	`attempt_number` integer NOT NULL,
	`route_id` text,
	`route_target_id` text,
	`provider_id` text,
	`credential_id` text,
	`upstream_model_id` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`latency_ms` real,
	`http_status` integer,
	`result` text,
	`error_scope` text,
	`error_code` text,
	`error_message` text,
	`retryable` integer NOT NULL DEFAULT false,
	`response_started` integer NOT NULL DEFAULT false
);
--> statement-breakpoint

-- ── Extend request_logs ─────────────────────────────────────

ALTER TABLE `request_logs` ADD COLUMN `ingress_protocol` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `route_id` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `public_model_id` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `final_provider_id` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `final_credential_id` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `upstream_model_id` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `attempt_count` integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `failover_count` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `cached_tokens` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `billing_mode` text;
--> statement-breakpoint
ALTER TABLE `request_logs` ADD COLUMN `cost_source` text;
--> statement-breakpoint

-- ── Seed default MiMo provider ──────────────────────────────

INSERT INTO `providers` (`id`, `type`, `name`, `slug`, `base_url`, `enabled`, `priority`, `routing_weight`, `health_status`, `health_message`, `config_json`, `billing_mode`, `last_health_check_at`, `created_at`, `updated_at`)
VALUES ('mimo-default', 'mimo', 'Xiaomi MiMo', 'mimo', 'https://api.xiaomimimo.com/v1', true, 0, 1, 'unknown', NULL, '{"authHeader":"Authorization","authPrefix":"Bearer ","anthropicBaseUrl":"https://api.xiaomimimo.com/anthropic"}', 'per_request', NULL, strftime('%s','now'), strftime('%s','now'));
--> statement-breakpoint

-- ── Migrate existing API keys to provider_credentials ───────
-- (Only if api_keys table has rows)

INSERT INTO `provider_credentials` (`id`, `provider_id`, `name`, `encrypted_secret`, `masked_secret`, `priority`, `status`, `cooldown_until`, `failure_count`, `success_count`, `last_used_at`, `last_success_at`, `last_error_at`, `last_error_code`, `last_error_message`, `created_at`, `updated_at`)
SELECT
  `id`,
  'mimo-default',
  `label`,
  `encrypted_key`,
  `masked_key`,
  `priority`,
  `status`,
  `cooldown_until`,
  0,
  0,
  `last_used_at`,
  NULL,
  `last_error_at`,
  `last_error_code`,
  `last_error_message`,
  `created_at`,
  `updated_at`
FROM `api_keys`
WHERE EXISTS (SELECT 1 FROM `api_keys` LIMIT 1);
--> statement-breakpoint

-- ── Link existing request_logs to mimo-default provider ──────

UPDATE `request_logs`
SET
  `ingress_protocol` = CASE
    WHEN `route` LIKE '%/v1/messages%' THEN 'anthropic'
    ELSE 'openai'
  END,
  `final_provider_id` = 'mimo-default',
  `final_credential_id` = `api_key_id`,
  `upstream_model_id` = `model`,
  `public_model_id` = `model`
WHERE `final_provider_id` IS NULL;
