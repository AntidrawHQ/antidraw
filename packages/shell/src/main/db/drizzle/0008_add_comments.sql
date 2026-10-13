CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspace_id` text NOT NULL,
	`component_name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`element` text,
	`text` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`conversation_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sent_at` integer,
	`completed_at` integer,
	`cleared_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comments_workspace_idx` ON `comments` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `comments_conversation_idx` ON `comments` (`conversation_id`);