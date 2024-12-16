// step 01

import { Octokit } from "octokit";
import { internalAction } from "@/_generated/server";
import { v } from "convex/values";

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
    console.log(`${args.owner} has ${ownerStarCount} stars`);
  },
});
