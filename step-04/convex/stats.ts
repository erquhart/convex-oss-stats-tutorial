import { Octokit } from "octokit";
import { internalAction, internalMutation } from "@/_generated/server";
import { v } from "convex/values";
import * as cheerio from "cheerio";
import { internal } from "@/_generated/api";
import { asyncMap } from "convex-helpers";

const getGithubRepoPageData = async (owner: string, name: string) => {
  const html = await fetch(`https://github.com/${owner}/${name}`).then((res) =>
    res.text()
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
  return {
    contributorCount: selectData("graphs/contributors") ?? 0,
    dependentCount: selectData("network/dependents") ?? 0,
  };
};

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
      await ctx.db.insert("githubRepos", {
        ...repo,
        contributorCount: 0,
        dependentCount: 0,
      });
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
      await ctx.db.insert("githubOwners", {
        name: args.name,
        starCount: args.starCount,
        contributorCount: args.contributorCount,
        dependentCount: args.dependentCount,
      });
      return;
    }

    await ctx.db.patch(existingOwner._id, {
      starCount: args.starCount,
      contributorCount: args.contributorCount,
      dependentCount: args.dependentCount,
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
    let ownerContributorCount = 0;
    let ownerDependentCount = 0;

    // Add an extra level of looping for the pages from the iterator
    for await (const { data: repos } of iterator) {
      const reposWithPageData = [];
      for (const repo of repos) {
        const pageData = await getGithubRepoPageData(args.owner, repo.name);
        console.log(repo.name, pageData);
        ownerStarCount += repo.stargazers_count ?? 0;
        ownerContributorCount += pageData.contributorCount ?? 0;
        ownerDependentCount += pageData.dependentCount ?? 0;
        reposWithPageData.push({
          owner: repo.owner.login,
          name: repo.name,
          starCount: repo.stargazers_count ?? 0,
          contributorCount: pageData.contributorCount,
          dependentCount: pageData.dependentCount,
        });
      }
      await ctx.runMutation(internal.stats.updateGithubRepos, {
        repos: reposWithPageData,
      });
    }
    await ctx.runMutation(internal.stats.updateGithubOwner, {
      name: args.owner,
      starCount: ownerStarCount,
      contributorCount: ownerContributorCount,
      dependentCount: ownerDependentCount,
    });
  },
});
