import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  githubOwners: defineTable({
    name: v.string(),
    starCount: v.number(),
    contributorCount: v.number(),
    dependentCount: v.number(),
  }).index("name", ["name"]),
  githubRepos: defineTable({
    owner: v.string(),
    name: v.string(),
    starCount: v.number(),
    contributorCount: v.number(),
    dependentCount: v.number(),
  })
    .index("owner", ["owner"])
    .index("owner_name", ["owner", "name"]),
});
