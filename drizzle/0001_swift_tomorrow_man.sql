CREATE TABLE `editor_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `editor_sessions_client_expiry` ON `editor_sessions` (`client_id`,`expires_at`);