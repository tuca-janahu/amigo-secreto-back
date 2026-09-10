ALTER TABLE "User" ADD COLUMN "name" TEXT;

DO $$
DECLARE
  user_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count FROM "User";

  IF user_count = 1 THEN
    UPDATE "User"
    SET "name" = 'Artur', "updatedAt" = CURRENT_TIMESTAMP
    WHERE "name" IS NULL;
  ELSIF user_count > 1 THEN
    RAISE EXCEPTION 'User name backfill requires a manual migration because more than one user exists.';
  END IF;
END $$;

ALTER TABLE "User" ALTER COLUMN "name" SET NOT NULL;
