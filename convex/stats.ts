import { Octokit } from "octokit";
import { asyncMap } from "convex-helpers";
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const updateGitHubOwner = internalMutation({
  args: {
    owner: v.string(),
    starCount: v.number(),
  },
  handler: async (ctx, args) => {
    const nameNormalized = args.owner.toLowerCase();

    // This query doesn't use an index, so it's scanning the entire table. Because
    // we're unlikely to have many owners in the table, this is fine.
    const existingOwner = await ctx.db
      .query("githubOwners")
      .filter((q) => q.eq(q.field("nameNormalized"), nameNormalized))
      .unique();

    if (!existingOwner) {
      await ctx.db.insert("githubOwners", {
        name: args.owner,
        nameNormalized,
        starCount: args.starCount,

        // Handy for some queries, I usually add this to all of my tables.
        // Convex provides a `_creationTime` field so no need for `createdAt`.
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(existingOwner._id, {
      starCount: args.starCount,
      updatedAt: Date.now(),
    });
  },
});

export const updateGitHubRepos = internalMutation({
  args: {
    owner: v.string(),
    repos: v.array(
      v.object({
        name: v.string(),
        starCount: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // We're expecting up to 100 repos per mutation call - we can write the mutation
    // to run them all in parallel and Convex will take care enforcing any necessary
    // concurrency limits.
    // TODO: Make sure this is accurate info
    await asyncMap(args.repos, async (repo) => {
      const normalizedName = repo.name.toLowerCase();
      const existingRepo = await ctx.db
        .query("githubRepos")
        .filter((q) => q.eq(q.field("nameNormalized"), normalizedName))
        .unique();
      if (!existingRepo) {
        await ctx.db.insert("githubRepos", {
          owner: args.owner,
          ownerNormalized: args.owner.toLowerCase(),
          name: repo.name,
          nameNormalized: normalizedName,
          starCount: repo.starCount,
          updatedAt: Date.now(),
        });
        return;
      }
      await ctx.db.patch(existingRepo._id, {
        starCount: repo.starCount,
        updatedAt: Date.now(),
      });
    });
  },
});

export const updateGitHubOwnerStats = internalAction({
  args: { owner: v.string() },
  handler: async (ctx, args) => {
    const octokit = new Octokit({ auth: process.env.GITHUB_ACCESS_TOKEN });
    const { data: user } = await octokit.rest.users.getByUsername({
      username: args.owner,
    });

    // Api calls can be different for users vs orgs
    const isOrg = user.type === "Organization";
    const iterator = isOrg
      ? octokit.paginate.iterator(octokit.rest.repos.listForOrg, {
          org: args.owner,
          per_page: 100,
        })
      : octokit.paginate.iterator(octokit.rest.repos.listForUser, {
          username: args.owner,
          per_page: 100,
        });

    let ownerStarCount = 0;
    for await (const { data: repos } of iterator) {
      await ctx.runMutation(internal.stats.updateGitHubRepos, {
        owner: args.owner,
        repos: repos.map((repo) => ({
          name: repo.name,
          starCount: repo.stargazers_count ?? 0,
        })),
      });
      for (const repo of repos) {
        ownerStarCount += repo.stargazers_count ?? 0;
      }
    }
    await ctx.runMutation(internal.stats.updateGitHubOwner, {
      owner: args.owner,
      starCount: ownerStarCount,
    });
  },
});
