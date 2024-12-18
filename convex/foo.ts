import { query } from "@/_generated/server";
import { api } from "./_generated/api";

export const get = query(async ({ db }) => {
  await db.query("githubOwners").first();
  return false;
});
