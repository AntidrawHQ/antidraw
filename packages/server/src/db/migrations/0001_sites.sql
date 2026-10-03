CREATE TABLE `publish` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`base_seq` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`committed_at` integer,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publish_site_id_idx` ON `publish` (`site_id`);--> statement-breakpoint
CREATE TABLE `site` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`live_publish_id` text,
	`previous_publish_id` text,
	`seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_slug_unique` ON `site` (`slug`);--> statement-breakpoint
CREATE INDEX `site_owner_id_idx` ON `site` (`owner_id`);