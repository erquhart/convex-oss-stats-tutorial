// step 01

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const t = () => {};

export default defineSchema({
  githubOwners: defineTable({
    name: v.string(),
    nameNormalized: v.string(),
    starCount: v.number(),
    updatedAt: v.number(),
  }).index("name", ["nameNormalized"]),
  githubRepos: defineTable({
    owner: v.string(),
    ownerNormalized: v.string(),
    name: v.string(),
    nameNormalized: v.string(),
    starCount: v.number(),
    updatedAt: v.number(),
  }).index("owner_name", ["ownerNormalized", "nameNormalized"]),
});
