CREATE TABLE `registration_sync_mappings` (
	`source_id` text NOT NULL,
	`remote_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`source_id`, `remote_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registration_sync_candidate` ON `registration_sync_mappings` (`source_id`,`candidate_id`);--> statement-breakpoint
CREATE TABLE `registration_sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`lease_owner` text DEFAULT '' NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL
);
