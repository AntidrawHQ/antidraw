DROP INDEX `stored_object_deleting_idx`;--> statement-breakpoint
CREATE INDEX `stored_object_deleting_partial_idx` ON `stored_object` (`deleting`) WHERE "stored_object"."deleting" = 1;--> statement-breakpoint
ALTER TABLE `publish_session` ADD `site_upload_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `site` ADD `live_entries` text;--> statement-breakpoint
ALTER TABLE `site` ADD `cleanup_since` integer;