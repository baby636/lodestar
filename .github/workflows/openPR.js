const {Octokit} = require("@octokit/core");

const octokit = new Octokit({auth: process.env.GITHUB_TOKEN}),
  owner = "chainsafe",
  repo = "lodestar",
  title = "Fix BLS pool bug",
  body = "",
  head = "dapplion/fix-bls-pool-bug",
  base = "master";

octokit.request(`POST /repos/{owner}/{repo}/pulls`, {owner, repo, title, body, head, base});
