-- Room owners and moderators can now unban, remove members and delete rooms (Stage D, ROOM-04 to
-- ROOM-06). Their actions go into the same append-only audit log as site moderators' actions, with
-- the room in `conversation_id`, so site admins can see how room moderation is used.
--
-- Adding enum values is additive (expand only): code from before this migration keeps working.
-- PostgreSQL cannot use a new enum value inside the transaction that adds it; nothing here does.

ALTER TYPE "public"."moderation_action_kind" ADD VALUE IF NOT EXISTS 'room_unban';--> statement-breakpoint
ALTER TYPE "public"."moderation_action_kind" ADD VALUE IF NOT EXISTS 'room_remove';--> statement-breakpoint
ALTER TYPE "public"."moderation_action_kind" ADD VALUE IF NOT EXISTS 'room_delete';
