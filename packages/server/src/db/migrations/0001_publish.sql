CREATE TABLE `publish_session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`site_id` text NOT NULL,
	`base_version` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`plan` text NOT NULL,
	`result_version` integer,
	`expires_at` integer NOT NULL,
	`hold_until` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publish_session_userId_status_idx` ON `publish_session` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `publish_session_expiresAt_idx` ON `publish_session` (`expires_at`);--> statement-breakpoint
CREATE INDEX `publish_session_holdUntil_idx` ON `publish_session` (`hold_until`);--> statement-breakpoint
CREATE INDEX `publish_session_siteId_idx` ON `publish_session` (`site_id`);--> statement-breakpoint
CREATE TABLE `publish_session_object` (
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	PRIMARY KEY(`session_id`, `kind`, `sha256`),
	FOREIGN KEY (`session_id`) REFERENCES `publish_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publish_session_object_userId_kind_sha256_idx` ON `publish_session_object` (`user_id`,`kind`,`sha256`);--> statement-breakpoint
CREATE TABLE `site` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`head_version` integer DEFAULT 0 NOT NULL,
	`allow_remix` integer DEFAULT true NOT NULL,
	`live_files` text,
	`protected_files` text,
	`complete_lock` text,
	`complete_lock_expires_at` integer,
	`cleanup_after` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_slug_unique` ON `site` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_userId_clientWorkspaceId_uidx` ON `site` (`user_id`,`client_workspace_id`);--> statement-breakpoint
CREATE TABLE `site_version` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`source_sha256` text NOT NULL,
	`source_size` integer NOT NULL,
	`snapshot_bytes` integer NOT NULL,
	`file_count` integer NOT NULL,
	`site_file_count` integer NOT NULL,
	`site_bytes` integer NOT NULL,
	`allow_remix` integer DEFAULT true NOT NULL,
	`keep` integer DEFAULT false NOT NULL,
	`publish_session_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_version_siteId_version_uidx` ON `site_version` (`site_id`,`version`);--> statement-breakpoint
CREATE INDEX `site_version_userId_sourceSha256_idx` ON `site_version` (`user_id`,`source_sha256`);--> statement-breakpoint
CREATE TABLE `stored_object` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`deleting` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `sha256`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stored_object_createdAt_idx` ON `stored_object` (`created_at`);--> statement-breakpoint
CREATE INDEX `stored_object_deleting_idx` ON `stored_object` (`deleting`);--> statement-breakpoint
CREATE TABLE `version_large_file` (
	`version_id` text NOT NULL,
	`user_id` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`mode` integer NOT NULL,
	PRIMARY KEY(`version_id`, `path`),
	FOREIGN KEY (`version_id`) REFERENCES `site_version`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `version_large_file_userId_sha256_idx` ON `version_large_file` (`user_id`,`sha256`);