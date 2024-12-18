import { internalAction, internalMutation } from "@/_generated/server";
import { v } from "convex/values";
import * as cheerio from "cheerio";
import { internal } from "@/_generated/api";
import { asyncMap } from "convex-helpers";
import pLimit from "p-limit";

const repoPageRetries = 3;

const getGithubRepoPageData = async (owner: string, name: string) => {
  // Some data, especially dependent count, randomly fails to load in the UI
  let retries = repoPageRetries;
  let contributorCount: number | undefined;
  let dependentCount: number | undefined;
  while (retries > 0) {
    const html = await fetch(`https://github.com/${owner}/${name}`).then(
      (res) => res.text()
    );
    const $ = cheerio.load(html);
    const parseNumber = (str = "") => Number(str.replace(/,/g, ""));
    const selectData = (hrefSubstring: string) => {
      const result = $(`a[href$="${hrefSubstring}"] > span.Counter`)
        .filter((_, el) => {
          const title = $(el).attr("title");
          return !!parseNumber(title);
        })
        .attr("title");
      return result ? parseNumber(result) : undefined;
    };
    contributorCount = selectData("graphs/contributors");
    dependentCount = selectData("network/dependents");
    if (contributorCount === undefined || dependentCount === undefined) {
      retries--;
      continue;
    }
    break;
  }
  return {
    contributorCount: contributorCount ?? 0,
    dependentCount: dependentCount ?? 0,
  };
};

export const updateGithubRepos = internalMutation({
  args: {
    repos: v.array(
      v.object({
        owner: v.string(),
        name: v.string(),
        starCount: v.number(),
        contributorCount: v.number(),
        dependentCount: v.number(),
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
      if (
        existingRepo?.starCount === repo.starCount &&
        existingRepo?.contributorCount === repo.contributorCount &&
        existingRepo?.dependentCount === repo.dependentCount
      ) {
        return;
      }
      if (existingRepo) {
        await ctx.db.patch(existingRepo._id, {
          starCount: repo.starCount || existingRepo.starCount,
          contributorCount:
            repo.contributorCount || existingRepo.contributorCount,
          dependentCount: repo.dependentCount || existingRepo.dependentCount,
        });
        return;
      }
      await ctx.db.insert("githubRepos", repo);
    });
  },
});

export const updateGithubOwner = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const ownerId =
      (
        await ctx.db
          .query("githubOwners")
          .withIndex("name", (q) => q.eq("name", args.name))
          .unique()
      )?._id ??
      (await ctx.db.insert("githubOwners", {
        name: args.name,
        starCount: 0,
        contributorCount: 0,
        dependentCount: 0,
      }));

    const repos = await ctx.db
      .query("githubRepos")
      .withIndex("owner", (q) => q.eq("owner", args.name))
      .collect();

    const { starCount, contributorCount, dependentCount } = repos.reduce(
      (acc, repo) => ({
        starCount: acc.starCount + repo.starCount,
        contributorCount: acc.contributorCount + repo.contributorCount,
        dependentCount: acc.dependentCount + repo.dependentCount,
      }),
      { starCount: 0, contributorCount: 0, dependentCount: 0 }
    );

    await ctx.db.patch(ownerId, {
      starCount,
      contributorCount,
      dependentCount,
    });
  },
});

export const updateGithubOwnerStats = internalAction({
  args: {
    owner: v.string(),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = args.page ?? 1;
    const response = await fetch(
      `https://api.github.com/users/${args.owner}/repos?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_ACCESS_TOKEN}`,
        },
      }
    );
    const repos: { name: string; stargazers_count: number }[] =
      await response.json();

    if (repos.length === 0) {
      await ctx.runMutation(internal.stats.updateGithubOwner, {
        name: args.owner,
      });
      return;
    }

    const repoLimit = pLimit(10);
    const reposWithPageData = await asyncMap(repos, async (repo) => {
      return repoLimit(async () => {
        const pageData = await getGithubRepoPageData(args.owner, repo.name);
        return {
          owner: args.owner,
          name: repo.name,
          starCount: repo.stargazers_count ?? 0,
          contributorCount: pageData.contributorCount,
          dependentCount: pageData.dependentCount,
        };
      });
    });

    await ctx.runMutation(internal.stats.updateGithubRepos, {
      repos: reposWithPageData,
    });

    await ctx.scheduler.runAfter(0, internal.stats.updateGithubOwnerStats, {
      owner: args.owner,
      page: page + 1,
    });
  },
});
