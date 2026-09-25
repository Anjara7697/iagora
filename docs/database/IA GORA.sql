CREATE TABLE "users" (
  "id" integer PRIMARY KEY,
  "username" varchar,
  "email" varchar,
  "role" varchar,
  "created_at" timestamp,
  "updated_at" timestamp
);

CREATE TABLE "prospects" (
  "id" integer PRIMARY KEY,
  "first_name" varchar,
  "last_name" varchar,
  "email" varchar,
  "phone" varchar,
  "linkedin_id" varchar,
  "facebook_id" varchar,
  "instagram_id" varchar,
  "created_at" timestamp,
  "updated_at" timestamp
);

CREATE TABLE "targets" (
  "id" integer PRIMARY KEY,
  "code" varchar,
  "name" varchar,
  "description" text
);

CREATE TABLE "campaigns" (
  "id" integer PRIMARY KEY,
  "name" varchar,
  "description" text,
  "status" varchar,
  "created_at" timestamp,
  "updated_at" timestamp
);

CREATE TABLE "campaign_targets" (
  "id" integer PRIMARY KEY,
  "campaign_id" integer,
  "target_id" integer
);

CREATE TABLE "sources" (
  "id" integer PRIMARY KEY,
  "name" varchar,
  "type" varchar,
  "platform" varchar,
  "external_id" varchar,
  "is_active" boolean,
  "created_at" timestamp,
  "updated_at" timestamp
);

CREATE TABLE "campaign_sources" (
  "id" integer PRIMARY KEY,
  "campaign_id" integer,
  "source_id" integer,
  "created_by" integer,
  "status" varchar,
  "start_date" timestamp,
  "end_date" timestamp,
  "created_at" timestamp,
  "updated_at" timestamp
);

CREATE TABLE "campaign_prospects" (
  "id" integer PRIMARY KEY,
  "campaign_source_id" integer,
  "prospect_id" integer,
  "interest_status" varchar,
  "conversion_stage" varchar,
  "interest_score" integer,
  "fit_score" integer,
  "total_score" integer,
  "assigned_advisor_id" integer,
  "created_at" timestamp,
  "updated_at" timestamp
);

CREATE TABLE "channels" (
  "id" integer PRIMARY KEY,
  "name" varchar,
  "type" varchar
);

CREATE TABLE "prospect_channels" (
  "id" integer PRIMARY KEY,
  "prospect_id" integer,
  "channel_id" integer,
  "channel_identifier" varchar,
  "is_preferred" boolean,
  "is_verified" boolean,
  "created_at" timestamp
);

CREATE TABLE "conversations" (
  "id" integer PRIMARY KEY,
  "prospect_id" integer,
  "channel_id" integer,
  "status" varchar,
  "started_at" timestamp,
  "last_message_at" timestamp,
  "closed_at" timestamp
);

CREATE TABLE "messages" (
  "id" integer PRIMARY KEY,
  "conversation_id" integer,
  "sender_type" varchar,
  "content" text,
  "external_message_id" varchar,
  "created_at" timestamp
);

CREATE TABLE "interactions" (
  "id" integer PRIMARY KEY,
  "prospect_id" integer,
  "channel_id" integer,
  "type" varchar,
  "direction" varchar,
  "content" text,
  "external_id" varchar,
  "created_at" timestamp
);

CREATE TABLE "score_events" (
  "id" integer PRIMARY KEY,
  "prospect_id" integer,
  "campaign_prospect_id" integer,
  "score_type" varchar,
  "points" integer,
  "reason" text,
  "created_at" timestamp
);

CREATE TABLE "follow_ups" (
  "id" integer PRIMARY KEY,
  "prospect_id" integer,
  "campaign_prospect_id" integer,
  "channel_id" integer,
  "scheduled_at" timestamp,
  "executed_at" timestamp,
  "status" varchar,
  "reason" text,
  "created_at" timestamp
);

CREATE TABLE "appointments" (
  "id" integer PRIMARY KEY,
  "prospect_id" integer,
  "advisor_id" integer,
  "calendar_event_id" varchar,
  "meeting_url" varchar,
  "start_at" timestamp,
  "end_at" timestamp,
  "status" varchar,
  "created_at" timestamp,
  "updated_at" timestamp
);

ALTER TABLE "campaign_sources" ADD FOREIGN KEY ("created_by") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "campaign_prospects" ADD FOREIGN KEY ("assigned_advisor_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD FOREIGN KEY ("advisor_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "campaign_targets" ADD FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "campaign_targets" ADD FOREIGN KEY ("target_id") REFERENCES "targets" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "campaign_sources" ADD FOREIGN KEY ("campaign_id") REFERENCES "campaigns" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "campaign_sources" ADD FOREIGN KEY ("source_id") REFERENCES "sources" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "campaign_prospects" ADD FOREIGN KEY ("campaign_source_id") REFERENCES "campaign_sources" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "campaign_prospects" ADD FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "prospect_channels" ADD FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "prospect_channels" ADD FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "conversations" ADD FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "conversations" ADD FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "messages" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "interactions" ADD FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "interactions" ADD FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "score_events" ADD FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "score_events" ADD FOREIGN KEY ("campaign_prospect_id") REFERENCES "campaign_prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "follow_ups" ADD FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "follow_ups" ADD FOREIGN KEY ("campaign_prospect_id") REFERENCES "campaign_prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "follow_ups" ADD FOREIGN KEY ("channel_id") REFERENCES "channels" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "appointments" ADD FOREIGN KEY ("prospect_id") REFERENCES "prospects" ("id") DEFERRABLE INITIALLY IMMEDIATE;
