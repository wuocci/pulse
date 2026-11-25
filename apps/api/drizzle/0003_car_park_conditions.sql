CREATE TABLE "car_park_conditions" (
	"bucket" timestamp with time zone NOT NULL,
	"source_id" text NOT NULL,
	"facility" text NOT NULL,
	"free_spaces" integer NOT NULL,
	"capacity" integer NOT NULL,
	CONSTRAINT "car_park_conditions_source_id_facility_bucket_pk" PRIMARY KEY("source_id","facility","bucket")
);
