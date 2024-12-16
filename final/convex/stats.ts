// step 03

import { Octokit } from "octokit";
import pLimit from "p-limit";
import { asyncMap } from "convex-helpers";
import { v } from "convex/values";
import { internalAction, internalMutation } from "@/_generated/server";
import { internal } from "@/_generated/api";
import { GenericActionCtx } from "convex/server";
import { chunk } from "remeda";

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

export const updateNpmOwnerStats = internalAction({
  args: { owner: v.string() },
  handler: async (ctx, args) => {
    let nextUrlSuffix = "";
    const packages = [];
    do {
      const response = await fetch(
        `https://www.npmjs.com/org/${args.owner}${nextUrlSuffix}`,
        {
          headers: {
            "cache-control": "no-cache",
            "x-spiferack": "1",
          },
        }
      );
      const json: {
        packages?: {
          objects: { name: string; created: { ts: number } }[];
          urls: { next: string };
        };
        message?: string;
      } = await response.json();
      if (!json.packages) {
        if (json.message === "NotFoundError: Scope not found") {
          console.error(`npm org ${args.owner} not found`);
        } else {
          console.error("syncNpm", {
            json,
          });
        }
        continue;
      }
      nextUrlSuffix = json.packages.urls.next;
      packages.push(
        ...json.packages.objects.map((pkg) => ({
          name: pkg.name,
          created: pkg.created.ts,
        }))
      );
    } while (nextUrlSuffix);
    const currentDateIso = new Date().toISOString().substring(0, 10);
    const packageLimit = pLimit(20);
    const packagesWithDownloadCount = await Promise.all(
      packages.map((pkg) =>
        packageLimit(async () => {
          let nextDate = new Date(pkg.created);
          let totalDownloadCount = 0;
          let hasMore = true;
          while (hasMore) {
            const from = nextDate.toISOString().substring(0, 10);
            nextDate.setDate(nextDate.getDate() + 17 * 30);
            if (nextDate.toISOString().substring(0, 10) > currentDateIso) {
              nextDate = new Date();
            }
            const to = nextDate.toISOString().substring(0, 10);
            const response = await fetch(
              `https://api.npmjs.org/downloads/range/${from}:${to}/${pkg.name}`
            );
            const json: {
              end: string;
              downloads: { day: string; downloads: number }[];
            } = await response.json();
            const downloadCount = json.downloads.reduce(
              (acc: number, cur: { downloads: number }) => acc + cur.downloads,
              0
            );
            totalDownloadCount += downloadCount;
            nextDate.setDate(nextDate.getDate() + 1);
            hasMore = json.end < currentDateIso;
          }
          nextDate.setDate(nextDate.getDate() - 30);
          const from = nextDate.toISOString().substring(0, 10);
          nextDate.setDate(nextDate.getDate() + 30);
          const to = nextDate.toISOString().substring(0, 10);
          const lastPageResponse = await fetch(
            `https://api.npmjs.org/downloads/range/${from}:${to}/${pkg.name}`
          );
          const lastPageJson: {
            end: string;
            downloads: { day: string; downloads: number }[];
          } = await lastPageResponse.json();
          // Create array of week of day averages, 0 = Sunday
          console.log(lastPageJson);
          const dayOfWeekAverages = Array(7)
            .fill(0)
            .map((_, idx) => {
              const total = lastPageJson.downloads
                .filter((day) => new Date(day.day).getDay() === idx)
                .reduce((acc, cur) => acc + cur.downloads, 0);
              return Math.round(total / 4);
            });
          return {
            name: pkg.name,
            downloadCount: totalDownloadCount,
            dayOfWeekAverages,
          };
        })
      )
    );
    const orgTotalDownloadCount = packagesWithDownloadCount.reduce(
      (acc: number, cur: { downloadCount: number }) => acc + cur.downloadCount,
      0
    );
    console.log(`${args.owner} total download count: ${orgTotalDownloadCount}`);
  },
});
