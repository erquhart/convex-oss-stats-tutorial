import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import * as cheerio from "cheerio";
import { internal } from "./_generated/api";
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
      (res) => res.text(),
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
      }),
    ),
  },
  handler: async (ctx, args) => {
    await asyncMap(args.repos, async (repo) => {
      const existingRepo = await ctx.db
        .query("githubRepos")
        .withIndex("owner_name", (q) =>
          q.eq("owner", repo.owner).eq("name", repo.name),
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
      { starCount: 0, contributorCount: 0, dependentCount: 0 },
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
      },
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

export const updateNpmPackagesForOrg = internalMutation({
  args: {
    org: v.string(),
    packages: v.array(
      v.object({
        name: v.string(),
        downloadCount: v.number(),
        // dayOfWeekAverages: v.array(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await asyncMap(args.packages, async (pkg) => {
      const existingPackage = await ctx.db
        .query("npmPackages")
        .withIndex("name", (q) => q.eq("name", pkg.name))
        .unique();
      if (existingPackage?.downloadCount === pkg.downloadCount) {
        return;
      }
      if (existingPackage) {
        await ctx.db.patch(existingPackage._id, {
          downloadCount: pkg.downloadCount || existingPackage.downloadCount,
        });
        return;
      }
      await ctx.db.insert("npmPackages", {
        org: args.org,
        name: pkg.name,
        downloadCount: pkg.downloadCount,
      });
    });
  },
});

const fetchNpmPackageListForOrg = async (org: string, page: number) => {
  const response = await fetch(
    `https://www.npmjs.com/org/${org}?page=${page}`,
    {
      headers: {
        "cache-control": "no-cache",
        "x-spiferack": "1",
      },
    },
  );
  const data: {
    scope: { type: "org" | "user" };
    packages?: {
      objects: { name: string; created: { ts: number } }[];
      urls: { next: string };
    };
    message?: string;
  } = await response.json();
  if (!data.packages && data.message === "NotFoundError: Scope not found") {
    throw new Error(`npm org ${org} not found`);
  }
  if (data.scope.type === "user") {
    throw new Error(`${org} is a user, not an org`);
  }
  if (!data.packages) {
    throw new Error(`no packages for ${org}, page ${page}`);
  }
  return {
    packages: data.packages.objects.map((pkg) => ({
      name: pkg.name,
      created: pkg.created.ts,
    })),
    hasMore: !!data.packages.urls.next,
  };
};

const fetchNpmPackageDownloadCount = async (name: string, created: number) => {
  const currentDateIso = new Date().toISOString().substring(0, 10);
  let nextDate = new Date(created);
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
      `https://api.npmjs.org/downloads/range/${from}:${to}/${name}`,
    );
    const pageData: {
      end: string;
      downloads: { day: string; downloads: number }[];
    } = await response.json();
    const downloadCount = pageData.downloads.reduce(
      (acc: number, cur: { downloads: number }) => acc + cur.downloads,
      0,
    );
    totalDownloadCount += downloadCount;
    nextDate.setDate(nextDate.getDate() + 1);
    hasMore = pageData.end < currentDateIso;
  }
  nextDate.setDate(nextDate.getDate() - 30);
  const from = nextDate.toISOString().substring(0, 10);
  nextDate.setDate(nextDate.getDate() + 30);
  const to = nextDate.toISOString().substring(0, 10);
  const lastPageResponse = await fetch(
    `https://api.npmjs.org/downloads/range/${from}:${to}/${name}`,
  );
  /*
      const lastPageData: {
        end: string;
        downloads: { day: string; downloads: number }[];
      } = await lastPageResponse.json();
      // Create array of week of day averages, 0 = Sunday
      const dayOfWeekAverages = Array(7)
        .fill(0)
        .map((_, idx) => {
          const total = lastPageData.downloads
            .filter((day) => new Date(day.day).getDay() === idx)
            .reduce((acc, cur) => acc + cur.downloads, 0);
          return Math.round(total / 4);
        });
        */
  return totalDownloadCount;
};

export const updateNpmOrg = internalMutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const orgId =
      (
        await ctx.db
          .query("npmOrgs")
          .withIndex("name", (q) => q.eq("name", args.name))
          .unique()
      )?._id ??
      (await ctx.db.insert("npmOrgs", {
        name: args.name,
        downloadCount: 0,
      }));
    const packages = await ctx.db
      .query("npmPackages")
      .withIndex("org", (q) => q.eq("org", args.name))
      .collect();
    const downloadCount = packages.reduce(
      (acc, pkg) => acc + pkg.downloadCount,
      0,
    );
    await ctx.db.patch(orgId, { downloadCount });
  },
});

export const updateNpmOwnerStats = internalAction({
  args: {
    org: v.string(),
    page: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const page = args.page ?? 0;
    const { packages, hasMore } = await fetchNpmPackageListForOrg(
      args.org,
      page,
    );
    const packagesWithDownloadCount = await asyncMap(packages, async (pkg) => {
      const totalDownloadCount = await fetchNpmPackageDownloadCount(
        pkg.name,
        pkg.created,
      );
      return {
        name: pkg.name,
        downloadCount: totalDownloadCount,
        // dayOfWeekAverages,
      };
    });

    await ctx.runMutation(internal.stats.updateNpmPackagesForOrg, {
      org: args.org,
      packages: packagesWithDownloadCount,
    });

    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.stats.updateNpmOwnerStats, {
        org: args.org,
        page: page + 1,
      });
      return;
    }

    await ctx.runMutation(internal.stats.updateNpmOrg, {
      name: args.org,
    });
  },
});
