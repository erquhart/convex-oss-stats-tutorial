import { Octokit } from "octokit";
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
      if (existingRepo?.starCount === repo.starCount) {
        return;
      }
      if (existingRepo) {
        await ctx.db.patch(existingRepo._id, repo);
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
    contributorCount: v.number(),
    dependentCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existingOwner = await ctx.db
      .query("githubOwners")
      .withIndex("name", (q) => q.eq("name", args.name))
      .unique();

    if (!existingOwner) {
      await ctx.db.insert("githubOwners", args);
      return;
    }

    await ctx.db.patch(existingOwner._id, args);
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
    let ownerContributorCount = 0;
    let ownerDependentCount = 0;

    for await (const { data: repos } of iterator) {
      const repoLimit = pLimit(100);
      const reposWithPageData = await Promise.all(
        repos.map(async (repo) => {
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
        })
      );

      await ctx.runMutation(internal.stats.updateGithubRepos, {
        repos: reposWithPageData,
      });

      ({ ownerStarCount, ownerContributorCount, ownerDependentCount } =
        reposWithPageData.reduce(
          (acc, repo) => ({
            ownerStarCount: acc.ownerStarCount + repo.starCount,
            ownerContributorCount:
              acc.ownerContributorCount + repo.contributorCount,
            ownerDependentCount: acc.ownerDependentCount + repo.dependentCount,
          }),
          {
            ownerStarCount,
            ownerContributorCount,
            ownerDependentCount,
          }
        ));
    }
    await ctx.runMutation(internal.stats.updateGithubOwner, {
      name: args.owner,
      starCount: ownerStarCount,
      contributorCount: ownerContributorCount,
      dependentCount: ownerDependentCount,
    });
  },
});
