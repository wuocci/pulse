CREATE TABLE "transit_line_conditions" (
	"bucket" timestamp with time zone NOT NULL,
	"source_id" text NOT NULL,
	"line" text NOT NULL,
	"direction" smallint NOT NULL,
	"avg_delay_s" real NOT NULL,
	"p90_delay_s" real NOT NULL,
	"vehicle_count" integer NOT NULL,
	CONSTRAINT "transit_line_conditions_source_id_line_direction_bucket_pk" PRIMARY KEY("source_id","line","direction","bucket")
);
