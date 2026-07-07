CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_hash_unique` ON `admin_sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `api_key_events` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` text NOT NULL,
	`event_type` text NOT NULL,
	`error_code` integer,
	`error_message` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`masked_key` text NOT NULL,
	`priority` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_used_at` integer,
	`last_error_code` integer,
	`last_error_message` text,
	`last_error_at` integer,
	`cooldown_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`timestamp` integer NOT NULL,
	`route` text NOT NULL,
	`model` text,
	`api_key_id` text,
	`status_code` integer,
	`latency_ms` real NOT NULL,
	`streaming` integer DEFAULT false NOT NULL,
	`fallback` integer DEFAULT false NOT NULL,
	`client_ip` text,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`cooldown_429_seconds` integer DEFAULT 60 NOT NULL,
	`cooldown_5xx_seconds` integer DEFAULT 60 NOT NULL,
	`cooldown_timeout_seconds` integer DEFAULT 60 NOT NULL,
	`request_timeout_seconds` integer DEFAULT 120 NOT NULL,
	`ip_allowlist` text DEFAULT '' NOT NULL,
	`public_model_ids` text DEFAULT 'mimo-v2.5,mimo-v2.5-pro' NOT NULL,
	`gateway_key_hash` text DEFAULT '' NOT NULL,
	`admin_password_hash` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
