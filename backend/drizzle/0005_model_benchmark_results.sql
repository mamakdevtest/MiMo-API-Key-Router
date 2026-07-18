CREATE TABLE `model_benchmark_results` (
  `provider_model_id` text PRIMARY KEY NOT NULL REFERENCES `provider_models`(`id`) ON DELETE CASCADE,
  `outcome` text NOT NULL,
  `latency_ms` real,
  `http_status` integer,
  `error_message` text,
  `tested_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_benchmark_results_tested_at_idx` ON `model_benchmark_results` (`tested_at`);
