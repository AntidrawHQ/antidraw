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
	`site_upload_bytes` integer DEFAULT 0 NOT NULL,
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
	`present` integer DEFAULT false NOT NULL,
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
	`pointer_version` integer DEFAULT 0 NOT NULL,
	`complete_lock` text,
	`complete_lock_expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_slug_unique` ON `site` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `site_userId_clientWorkspaceId_uidx` ON `site` (`user_id`,`client_workspace_id`);--> statement-breakpoint
CREATE INDEX `site_pointer_behind_partial_idx` ON `site` (`head_version`) WHERE "site"."pointer_version" < "site"."head_version";--> statement-breakpoint
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
	`site_file_row_bytes` integer DEFAULT 0 NOT NULL,
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
CREATE INDEX `stored_object_deleting_partial_idx` ON `stored_object` (`deleting`) WHERE "stored_object"."deleting" = 1;--> statement-breakpoint
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
CREATE INDEX `version_large_file_userId_sha256_idx` ON `version_large_file` (`user_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `version_site_file` (
	`version_id` text NOT NULL,
	`user_id` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`immutable` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`version_id`, `path`),
	FOREIGN KEY (`version_id`) REFERENCES `site_version`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `version_site_file_userId_sha256_idx` ON `version_site_file` (`user_id`,`sha256`);