-- Custom SQL migration file, put your code below! --

-- Backfill the deprecated "completed" stream status into "idle".
-- "completed" was removed from the StreamStatus union; the backend no longer
-- writes it and every reader only distinguishes "streaming" from not. This is
-- a one-time historical data fix (crash recovery for "streaming" rows still
-- happens on every boot in resetStreamingConversations).
UPDATE `conversations` SET `stream_status` = 'idle' WHERE `stream_status` = 'completed';
