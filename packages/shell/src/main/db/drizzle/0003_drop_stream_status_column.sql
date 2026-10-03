-- streamStatus is no longer persisted: a stream is a child process that cannot
-- outlive the app, so the live status is derived in memory (stream-manager
-- getStreamStatus) and attached to conversations at the service boundary.
-- The column could only ever be stale across a restart (boot used to reset it).
ALTER TABLE `conversations` DROP COLUMN `stream_status`;