import { Octokit } from "octokit";
import { internalAction, internalMutation } from "@/_generated/server";
import { v } from "convex/values";
import { internal } from "@/_generated/api";

export const updateGithubOwner = internalMutation({
  args: {
    name: v.string(),
    starCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existingOwner = await ctx.db
      .query("githubOwners")
      .filter((q) => q.eq(q.field("name"), args.name))
      .unique();

    if (!existingOwner) {
      await ctx.db.insert("githubOwners", {
        name: args.name,
        starCount: args.starCount,
      });
      return;
    }

    await ctx.db.patch(existingOwner._id, {
      starCount: args.starCount,
    });
  },
});

export const updateGithubOwnerStats = internalAction({
  args: { owner: v.string() },
  handler: async (ctx, args) => {
    const octokit = new Octokit({ auth: process.env.GITHUB_ACCESS_TOKEN });
    const iterator = octokit.paginate.iterator(octokit.rest.repos.listForUser, {
      username: args.owner,
      per_page: 100,
    });

    let ownerStarCount = 0;

    // Add an extra level of looping for the pages from the iterator
    for await (const { data: repos } of iterator) {
      for (const repo of repos) {
        ownerStarCount += repo.stargazers_count ?? 0;
      }
    }
    await ctx.runMutation(internal.stats.updateGithubOwner, {
      name: args.owner,
      starCount: ownerStarCount,
    });
  },
});
