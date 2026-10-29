CREATE TABLE "classifier_answers" (
	"state_hash" text NOT NULL,
	"question_version" integer NOT NULL,
	"model" text NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classifier_answers_state_hash_question_version_model_pk" PRIMARY KEY("state_hash","question_version","model")
);
