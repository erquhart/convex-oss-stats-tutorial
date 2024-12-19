import { httpRouter } from "convex/server";
import { Webhooks } from "@octokit/webhooks";
import { internal } from "_generated/api";
import { httpAction } from "_generated/server";

const http = httpRouter();

http.route({
  path: "/events/github",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const webhooks = new Webhooks({
      secret: process.env.GITHUB_WEBHOOK_SECRET!,
    });

    const signature = request.headers.get("x-hub-signature-256")!;
    const bodyString = await request.text();

    if (!(await webhooks.verify(bodyString, signature))) {
      return new Response("Unauthorized", { status: 401 });
    }
    const body = JSON.parse(bodyString);
    const {
      repository,
    }: {
      repository: {
        name: string;
        owner: { login: string };
        stargazers_count: number;
      };
    } = body;
    await ctx.runMutation(internal.stats.updateGithubRepoStars, {
      owner: repository.owner.login,
      name: repository.name,
      starCount: repository.stargazers_count,
    });
    return new Response(null, { status: 200 });
  }),
});

export default http;
