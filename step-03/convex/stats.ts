import { Octokit } from "octokit";
import { internalAction, internalMutation } from "@/_generated/server";
import { v } from "convex/values";
import { internal } from "@/_generated/api";
import { asyncMap } from "convex-helpers";

export const updateGithubRepos = internalMutation({
  args: {
    repos: v.array(
      v.object({
        owner: v.string(),
        name: v.string(),
        starCount: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await asyncMap(args.repos, async (repo) => {
      const existingRepo = await ctx.db
        .query("githubRepos")
        .withIndex("owner_name", (q) =>
          q.eq("owner", repo.owner).eq("name", repo.name)
        )
        .unique();
      if (existingRepo?.starCount === repo.starCount) {
        return;
      }
      if (existingRepo) {
        await ctx.db.patch(existingRepo._id, {
          starCount: repo.starCount,
        });
        return;
      }
      await ctx.db.insert("githubRepos", repo);
    });
  },
});

export const updateGithubOwner = internalMutation({
  args: {
    name: v.string(),
    starCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existingOwner = await ctx.db
      .query("githubOwners")
      .withIndex("name", (q) => q.eq("name", args.name))
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
      await ctx.runMutation(internal.stats.updateGithubRepos, {
        repos: repos.map((repo) => ({
          owner: repo.owner.login,
          name: repo.name,
          starCount: repo.stargazers_count ?? 0,
        })),
      });
    }
    await ctx.runMutation(internal.stats.updateGithubOwner, {
      name: args.owner,
      starCount: ownerStarCount,
    });
  },
});
