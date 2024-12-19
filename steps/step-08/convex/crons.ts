import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "update stats",
  { minuteUTC: 0 }, // At the top of every hour
  internal.stats.updateGithubOwnerStats,
  { owner: "tanstack" },
);

crons.hourly(
  "update npm stats",
  { minuteUTC: 0 }, // At the top of every hour
  internal.stats.updateNpmOwnerStats,
  { owner: "tanstack" },
);
