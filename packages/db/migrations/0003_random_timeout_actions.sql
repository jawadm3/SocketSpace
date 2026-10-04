-- Random-mode timeouts (Stage E, RAND-05) are written to the same append-only audit log as every
-- other sanction: `random_timeout` when one is set (by a moderator, or automatically after a
-- high-severity filter hit or repeated reports) and `random_timeout_lifted` when a moderator
-- ends one early.
--
-- Adding enum values is additive (expand only): code from before this migration keeps working.
-- PostgreSQL cannot use a new enum value inside the transaction that adds it; nothing here does.

ALTER TYPE "public"."moderation_action_kind" ADD VALUE IF NOT EXISTS 'random_timeout';--> statement-breakpoint
ALTER TYPE "public"."moderation_action_kind" ADD VALUE IF NOT EXISTS 'random_timeout_lifted';
