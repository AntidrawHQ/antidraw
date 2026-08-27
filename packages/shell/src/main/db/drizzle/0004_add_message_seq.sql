PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`message_type` text NOT NULL,
	`sdk_message` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Hand-edited from the drizzle-kit output. The generator copies a rebuild
-- column-for-column, so it emitted `SELECT "seq" ... FROM messages` — but seq
-- is new here and does not exist on the old table, and SQLite's legacy
-- double-quote fallback turns that into the string literal 'seq', which fails
-- the INTEGER PRIMARY KEY with a datatype mismatch mid-rebuild. Omit seq so
-- SQLite assigns it, ordered by (created_at, rowid): created_at only has
-- second resolution, so within a shared second the original insertion order
-- is the best available truth.
INSERT INTO `__new_messages`("id", "conversation_id", "message_type", "sdk_message", "created_at") SELECT "id", "conversation_id", "message_type", "sdk_message", "created_at" FROM `messages` ORDER BY "created_at", "rowid";--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_id_unique` ON `messages` (`id`);--> statement-breakpoint
CREATE INDEX `idx_messages_conv_seq` ON `messages` (`conversation_id`,`seq`);