CREATE TABLE "app_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_routines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"renewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_routines" ADD CONSTRAINT "app_routines_device_id_app_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."app_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_routines_device_id" ON "app_routines" USING btree ("device_id");