// step 01

import { Octokit } from "octokit";
import { internalAction } from "@/_generated/server";
import { v } from "convex/values";

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
      for (const repo of repos) {
        ownerStarCount += repo.stargazers_count ?? 0;
      }
    }
    console.log(`${args.owner} has ${ownerStarCount} stars`);
  },
});
