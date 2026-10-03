ALTER TABLE `messages` ADD `delivered_at` integer;--> statement-breakpoint
-- Every prompt persisted before this release was delivered: the CLI ran it.
-- Stamp it with its own created_at, or it reads "Not delivered" under the new
-- rule (null delivered_at, no live handle holding it pending).
UPDATE `messages` SET `delivered_at` = `created_at` WHERE `message_type` = 'user_prompt';
