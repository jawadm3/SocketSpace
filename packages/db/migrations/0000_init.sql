CREATE TYPE "public"."attachment_status" AS ENUM('pending', 'attached', 'removed');--> statement-breakpoint
CREATE TYPE "public"."avatar_kind" AS ENUM('preset', 'custom', 'photo');--> statement-breakpoint
CREATE TYPE "public"."color_mode" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."contact_request_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."contact_source" AS ENUM('manual', 'random');--> statement-breakpoint
CREATE TYPE "public"."conversation_kind" AS ENUM('room', 'dm');--> statement-breakpoint
CREATE TYPE "public"."conversation_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."deleted_by" AS ENUM('author', 'moderator');--> statement-breakpoint
CREATE TYPE "public"."dm_policy" AS ENUM('everyone', 'contacts', 'nobody');--> statement-breakpoint
CREATE TYPE "public"."flag_severity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."flag_source" AS ENUM('wordlist', 'ai');--> statement-breakpoint
CREATE TYPE "public"."link_preview_status" AS ENUM('ok', 'blocked', 'error');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'moderator', 'member');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'system');--> statement-breakpoint
CREATE TYPE "public"."moderation_action_kind" AS ENUM('warn', 'mute', 'unmute', 'suspend', 'unsuspend', 'ban', 'unban', 'remove_message', 'restore_message', 'resolve_report', 'dismiss_report', 'role_change', 'room_ban');--> statement-breakpoint
CREATE TYPE "public"."moderation_state" AS ENUM('visible', 'flagged', 'removed');--> statement-breakpoint
CREATE TYPE "public"."name_display" AS ENUM('nickname', 'real_name', 'both');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('mention', 'reply', 'dm', 'invite', 'contact_request', 'moderation');--> statement-breakpoint
CREATE TYPE "public"."notify_level" AS ENUM('all', 'mentions', 'none');--> statement-breakpoint
CREATE TYPE "public"."random_end_reason" AS ENUM('skip', 'end', 'disconnect', 'report', 'filter', 'timeout');--> statement-breakpoint
CREATE TYPE "public"."real_name_visibility" AS ENUM('nobody', 'contacts', 'everyone');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'hate', 'sexual', 'self_harm', 'violence', 'illegal', 'underage', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'in_review', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('message', 'user', 'room', 'random_session');--> statement-breakpoint
CREATE TYPE "public"."sanction_kind" AS ENUM('warn', 'mute', 'suspend', 'ban', 'random_timeout');--> statement-breakpoint
CREATE TYPE "public"."sanction_scope" AS ENUM('global', 'random');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('airmail', 'signal', 'aurora');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned', 'deleted');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_lockout" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"first_failure_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"nickname" text,
	"real_name_visibility" real_name_visibility DEFAULT 'nobody' NOT NULL,
	"name_display" "name_display" DEFAULT 'nickname' NOT NULL,
	"avatar_kind" "avatar_kind",
	"avatar_config" jsonb,
	"theme" "theme" DEFAULT 'airmail' NOT NULL,
	"color_mode" "color_mode" DEFAULT 'system' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"bio" text DEFAULT '' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"dm_policy" "dm_policy" DEFAULT 'everyone' NOT NULL,
	"show_presence" boolean DEFAULT true NOT NULL,
	"read_receipts" boolean DEFAULT true NOT NULL,
	"adult_confirmed_at" timestamp with time zone,
	"random_terms_version" text,
	"random_terms_accepted_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_nickname_format" CHECK ("user"."nickname" IS NULL OR "user"."nickname" ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,22}[A-Za-z0-9]$'),
	CONSTRAINT "user_bio_length" CHECK (char_length("user"."bio") <= 160),
	CONSTRAINT "user_onboarded_complete" CHECK ("user"."onboarded_at" IS NULL OR ("user"."nickname" IS NOT NULL AND "user"."avatar_kind" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "conversation_kind" NOT NULL,
	"visibility" "conversation_visibility" NOT NULL,
	"slug" text,
	"name" text,
	"topic" text,
	"dm_key" text,
	"created_by" uuid,
	"last_event_seq" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"member_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_dm_key_unique" UNIQUE("dm_key"),
	CONSTRAINT "conversation_room_fields" CHECK (("conversation"."kind" = 'room' AND "conversation"."slug" IS NOT NULL AND "conversation"."name" IS NOT NULL AND "conversation"."dm_key" IS NULL)
        OR ("conversation"."kind" = 'dm' AND "conversation"."slug" IS NULL AND "conversation"."dm_key" IS NOT NULL AND "conversation"."visibility" = 'private')),
	CONSTRAINT "conversation_slug_format" CHECK ("conversation"."slug" IS NULL OR "conversation"."slug" ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'),
	CONSTRAINT "conversation_name_length" CHECK ("conversation"."name" IS NULL OR char_length("conversation"."name") <= 50),
	CONSTRAINT "conversation_topic_length" CHECK ("conversation"."topic" IS NULL OR char_length("conversation"."topic") <= 200),
	CONSTRAINT "conversation_seq_nonnegative" CHECK ("conversation"."last_event_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation_member" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"last_delivered_seq" bigint DEFAULT 0 NOT NULL,
	"notify_level" "notify_level" DEFAULT 'all' NOT NULL,
	"muted_until" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_member_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"use_count" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "invite_uses" CHECK ("invite"."max_uses" IS NULL OR ("invite"."max_uses" > 0 AND "invite"."use_count" <= "invite"."max_uses"))
);
--> statement-breakpoint
CREATE TABLE "room_ban" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"banned_by" uuid,
	"reason" text DEFAULT '' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_ban_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uploader_id" uuid NOT NULL,
	"message_id" uuid,
	"storage_key" text NOT NULL,
	"thumb_key" text,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" "attachment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "link_preview" (
	"url_hash" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"status" "link_preview_status" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mention" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "mention_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"version_seq" bigint NOT NULL,
	"author_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "message_kind" DEFAULT 'text' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"body_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, body)) STORED,
	"reply_to_id" uuid,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"deleted_by" "deleted_by",
	"moderation_state" "moderation_state" DEFAULT 'visible' NOT NULL,
	"filter_severity" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_conversation_seq_uq" UNIQUE("conversation_id","seq"),
	CONSTRAINT "message_author_client_uq" UNIQUE("author_id","client_id"),
	CONSTRAINT "message_body_length" CHECK (char_length("message"."body") <= 4000),
	CONSTRAINT "message_seq_positive" CHECK ("message"."seq" > 0 AND "message"."version_seq" >= "message"."seq"),
	CONSTRAINT "message_filter_severity" CHECK ("message"."filter_severity" BETWEEN 0 AND 3),
	CONSTRAINT "message_deleted_consistent" CHECK (("message"."deleted_at" IS NULL) = ("message"."deleted_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "message_link" (
	"message_id" uuid NOT NULL,
	"url_hash" text NOT NULL,
	CONSTRAINT "message_link_message_id_url_hash_pk" PRIMARY KEY("message_id","url_hash")
);
--> statement-breakpoint
CREATE TABLE "message_revision" (
	"message_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_revision_message_id_revision_pk" PRIMARY KEY("message_id","revision")
);
--> statement-breakpoint
CREATE TABLE "reaction" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_message_id_user_id_emoji_pk" PRIMARY KEY("message_id","user_id","emoji"),
	CONSTRAINT "reaction_emoji_length" CHECK (char_length("reaction"."emoji") BETWEEN 1 AND 16)
);
--> statement-breakpoint
CREATE TABLE "block" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "block_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "block_not_self" CHECK ("block"."blocker_id" <> "block"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"user_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"source" "contact_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_user_id_contact_id_pk" PRIMARY KEY("user_id","contact_id"),
	CONSTRAINT "contact_not_self" CHECK ("contact"."user_id" <> "contact"."contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"status" "contact_request_status" DEFAULT 'pending' NOT NULL,
	"source" "contact_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "contact_request_not_self" CHECK ("contact_request"."from_id" <> "contact_request"."to_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "content_flag" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" "flag_source" NOT NULL,
	"severity" "flag_severity" NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"message_id" uuid,
	"random_session_id" uuid,
	"excerpt" text DEFAULT '' NOT NULL,
	"user_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_action" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "moderation_action_kind" NOT NULL,
	"target_user_id" uuid,
	"message_id" uuid,
	"report_id" uuid,
	"conversation_id" uuid,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_action_reason_present" CHECK (char_length(btrim("moderation_action"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "network_ban" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ip_hash" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "random_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" "random_end_reason",
	"participant_a" uuid,
	"participant_b" uuid,
	"shared_interest_count" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid,
	"target_type" "report_target" NOT NULL,
	"target_user_id" uuid,
	"message_id" uuid,
	"conversation_id" uuid,
	"random_session_id" uuid,
	"reason" "report_reason" NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"evidence" jsonb,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"assigned_to" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "report_details_length" CHECK (char_length("report"."details") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "user_sanction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "sanction_kind" NOT NULL,
	"scope" "sanction_scope" NOT NULL,
	"reason" text NOT NULL,
	"action_id" uuid,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "http_rate_limit" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "http_rate_limit_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "metric_daily" (
	"day" date NOT NULL,
	"name" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "metric_daily_day_name_pk" PRIMARY KEY("day","name")
);
--> statement-breakpoint
CREATE TABLE "realtime_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "realtime_outbox_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_member" ADD CONSTRAINT "conversation_member_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_member" ADD CONSTRAINT "conversation_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ban" ADD CONSTRAINT "room_ban_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ban" ADD CONSTRAINT "room_ban_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_ban" ADD CONSTRAINT "room_ban_banned_by_user_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploader_id_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_reply_to_id_message_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_link" ADD CONSTRAINT "message_link_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_link" ADD CONSTRAINT "message_link_url_hash_link_preview_url_hash_fk" FOREIGN KEY ("url_hash") REFERENCES "public"."link_preview"("url_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_revision" ADD CONSTRAINT "message_revision_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocker_id_user_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block" ADD CONSTRAINT "block_blocked_id_user_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_contact_id_user_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_request" ADD CONSTRAINT "contact_request_from_id_user_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_request" ADD CONSTRAINT "contact_request_to_id_user_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_flag" ADD CONSTRAINT "content_flag_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_flag" ADD CONSTRAINT "content_flag_random_session_id_random_session_id_fk" FOREIGN KEY ("random_session_id") REFERENCES "public"."random_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_flag" ADD CONSTRAINT "content_flag_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_flag" ADD CONSTRAINT "content_flag_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "random_session" ADD CONSTRAINT "random_session_participant_a_user_id_fk" FOREIGN KEY ("participant_a") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "random_session" ADD CONSTRAINT "random_session_participant_b_user_id_fk" FOREIGN KEY ("participant_b") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_random_session_id_random_session_id_fk" FOREIGN KEY ("random_session_id") REFERENCES "public"."random_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanction" ADD CONSTRAINT "user_sanction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanction" ADD CONSTRAINT "user_sanction_action_id_moderation_action_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."moderation_action"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_uq" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_uq" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_nickname_lower_uq" ON "user" USING btree (lower("nickname"));--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_slug_lower_uq" ON "conversation" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "conversation_last_message_at_idx" ON "conversation" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_member_user_id_idx" ON "conversation_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invite_conversation_id_idx" ON "invite" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "attachment_message_id_idx" ON "attachment" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "attachment_uploader_status_idx" ON "attachment" USING btree ("uploader_id","status");--> statement-breakpoint
CREATE INDEX "mention_user_id_idx" ON "mention" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_conversation_version_idx" ON "message" USING btree ("conversation_id","version_seq");--> statement-breakpoint
CREATE INDEX "message_body_tsv_idx" ON "message" USING gin ("body_tsv");--> statement-breakpoint
CREATE INDEX "block_blocked_id_idx" ON "block" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_request_pending_uq" ON "contact_request" USING btree ("from_id","to_id") WHERE "contact_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "contact_request_to_id_idx" ON "contact_request" USING btree ("to_id");--> statement-breakpoint
CREATE INDEX "notification_user_created_idx" ON "notification" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notification_user_unread_idx" ON "notification" USING btree ("user_id") WHERE "notification"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "content_flag_unreviewed_idx" ON "content_flag" USING btree ("created_at") WHERE "content_flag"."reviewed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "moderation_action_created_idx" ON "moderation_action" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "moderation_action_target_idx" ON "moderation_action" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "network_ban_ip_hash_idx" ON "network_ban" USING btree ("ip_hash");--> statement-breakpoint
CREATE INDEX "random_session_started_at_idx" ON "random_session" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "random_session_participant_a_idx" ON "random_session" USING btree ("participant_a");--> statement-breakpoint
CREATE INDEX "random_session_participant_b_idx" ON "random_session" USING btree ("participant_b");--> statement-breakpoint
CREATE INDEX "report_status_created_idx" ON "report" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "report_target_user_idx" ON "report" USING btree ("target_user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_sanction_active_idx" ON "user_sanction" USING btree ("user_id") WHERE "user_sanction"."lifted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "realtime_outbox_pending_idx" ON "realtime_outbox" USING btree ("created_at");