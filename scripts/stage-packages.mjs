// Stages the tarballs that `changeset pack` wrote on npm, where a maintainer approves them with 2FA in
// the Staged Packages tab. Changesets can't stage yet, so the Release workflow runs this as the script
// of changesets/action/publish, which pushes a git tag and creates a GitHub release for each version
// listed in CHANGESETS_OUTPUT. Needs npm 11.15 or later; in CI it signs in by trusted publishing.
//
//   node scripts/stage-packages.mjs <pack-dir> [--dry-run]
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packDir = process.argv[2];
if (!packDir || packDir.startsWith("--")) throw new Error("Pass the folder `changeset pack` wrote to.");
const dryRun = process.argv.includes("--dry-run");
const { plan } = JSON.parse(readFileSync(join(packDir, "publish-plan.json"), "utf8"));

// The action warns when the file is missing, which it is when nothing was staged.
const output = dryRun ? undefined : process.env.CHANGESETS_OUTPUT;
if (output) appendFileSync(output, "");

// npm shows a staged version to no one until it's approved, so until then the plan lists it again on
// every push to main. Its git tag is what says it was staged already.
const tags = new Set(
  execFileSync("git", ["ls-remote", "--tags", "origin"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.split("\trefs/tags/")[1]?.replace(/\^\{\}$/, ""))
    .filter(Boolean),
);

// The plan lists dependencies first. A failure stops here, so nothing is staged that pins a version
// of ours that wasn't; running the job again picks up from the package that failed.
for (const { kind, name, version, access, tag, tarball } of plan.flat()) {
  if (kind !== "publish") continue;
  const id = `${name}@${version}`;
  if (tags.has(id)) {
    console.log(`${id} is tagged, so it was staged before.`);
    continue;
  }
  const flags = ["--access", access, "--tag", tag, ...(dryRun ? ["--dry-run"] : [])];
  execFileSync("npm", ["stage", "publish", join(packDir, tarball.path), ...flags], { stdio: "inherit" });
  if (output) appendFileSync(output, `${JSON.stringify({ type: "git-tag", tag: id, packageName: name })}\n`);
}
