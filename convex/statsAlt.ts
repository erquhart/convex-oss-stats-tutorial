import { Octokit } from "octokit";

const octokit = new Octokit({ auth: "GITHUB_TOKEN" });

const getGitHubOwnerStats = async (owner: string) => {
  const { data: user } = await octokit.rest.users.getByUsername({
    // Name of a GitHub org or user
    username: owner,
  });

  // Api calls can be different for users vs orgs
  const isOrg = user.type === "Organization";
  const iteratorFn = isOrg
    ? octokit.rest.repos.listForOrg
    : octokit.rest.repos.listForUser;
  const iterator = octokit.paginate.iterator(iteratorFn, {
    org: owner,
    per_page: 100,
  });

  let starCount = 0;
  for await (const { data: repos } of iterator) {
    for (const repo of repos) {
      starCount += repo.stargazers_count ?? 0;
    }
  }
  console.log(`${owner} has ${starCount} stars`);
  return starCount;
};
