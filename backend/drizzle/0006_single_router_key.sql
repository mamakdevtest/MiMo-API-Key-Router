-- The router now accepts one deployment-managed GATEWAY_KEY only.
-- Remove every temporary key before dropping the legacy table.
DELETE FROM `gateway_credentials`;
--> statement-breakpoint
DROP TABLE `gateway_credentials`;
