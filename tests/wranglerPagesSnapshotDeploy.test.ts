import * as assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
	deployPublicHtmlSnapshotToWranglerPages,
	type PublicHtmlSnapshotDeployRuntimeModules,
} from "../src/publish/wranglerPagesSnapshotDeploy";
import {
	resetResolvedWranglerExecutionEnvForTests,
} from "../src/publish/wranglerPagesPublisher";

function createTrackedProcessStub() {
	return {
		stdin: {
			end() {},
		},
		on() {},
		kill() {
			return true;
		},
	};
}

test("deployPublicHtmlSnapshotToWranglerPages stages Pages Functions beside the asset directory before invoking Wrangler", async () => {
	resetResolvedWranglerExecutionEnvForTests();
	const actions: string[] = [];
	const mkdirCalls: string[] = [];
	const writeCalls: Array<{
		path: string;
		contents: string;
		encoding?: "utf8";
	}> = [];
	const deployCalls: Array<{
		args: string[];
		cwd?: string;
	}> = [];
	const modules: PublicHtmlSnapshotDeployRuntimeModules = {
		childProcess: {
			execFile(_file, args, options, callback) {
				if (args[0] === "-lic") {
					actions.push("shell:path");
					callback(null, "/usr/local/bin:/usr/bin\n", "");
				} else {
					actions.push(`wrangler:${args.slice(0, 2).join(" ")}`);
					deployCalls.push({
						args,
						cwd: options.cwd,
					});
					callback(null, "success", "");
				}
				return createTrackedProcessStub();
			},
		},
		fsPromises: {
			async mkdtemp(prefix) {
				actions.push(`mkdtemp:${prefix}`);
				return "/tmp/aside-stage";
			},
			async mkdir(targetPath) {
				actions.push(`mkdir:${targetPath}`);
				mkdirCalls.push(targetPath);
			},
			async writeFile(targetPath, contents, encoding) {
				actions.push(`write:${targetPath}`);
				writeCalls.push({
					path: targetPath,
					contents: typeof contents === "string" ? contents : Buffer.from(contents).toString("utf8"),
					encoding,
				});
			},
			async rm(targetPath) {
				actions.push(`rm:${targetPath}`);
			},
		},
		os: {
			tmpdir: () => "/tmp",
		},
		path: path.posix,
	};

	const result = await deployPublicHtmlSnapshotToWranglerPages(modules, {
		files: [{
			vaultRelativePath: "public/page.html",
			contents: "<!doctype html><html><body>Page</body></html>",
		}],
		staticAssets: [{
			assetRelativePath: "_routes.json",
			contents: "{\"version\":1}",
		}],
		projectFiles: [{
			projectRelativePath: "functions/_middleware.js",
			contents: "export function onRequest(context) { return context.next(); }",
		}, {
			projectRelativePath: "src/_aside/private-publish-data.js",
			contents: "export const privatePublishManifest = {};",
		}],
		projectName: "publish-site",
		publishBaseUrl: "https://publish-site.pages.dev",
		vaultRootPath: "/Users/test/vault",
		env: {
			SHELL: "/bin/zsh",
		},
	});

	assert.deepEqual(result, { ok: true });
	assert.deepEqual(writeCalls, [{
		path: "/tmp/aside-stage/assets/public/page.html",
		contents: "<!doctype html><html><body>Page</body></html>",
		encoding: "utf8",
	}, {
		path: "/tmp/aside-stage/assets/_routes.json",
		contents: "{\"version\":1}",
		encoding: "utf8",
	}, {
		path: "/tmp/aside-stage/functions/_middleware.js",
		contents: "export function onRequest(context) { return context.next(); }",
		encoding: "utf8",
	}, {
		path: "/tmp/aside-stage/src/_aside/private-publish-data.js",
		contents: "export const privatePublishManifest = {};",
		encoding: "utf8",
	}]);
	assert.ok(mkdirCalls.includes("/tmp/aside-stage/assets/public"));
	assert.ok(mkdirCalls.includes("/tmp/aside-stage/functions"));
	assert.ok(mkdirCalls.includes("/tmp/aside-stage/src/_aside"));
	assert.deepEqual(deployCalls.at(-1), {
		args: ["pages", "deploy", "/tmp/aside-stage/assets", "--project-name", "publish-site"],
		cwd: "/tmp/aside-stage",
	});
	assert.ok(
		actions.indexOf("write:/tmp/aside-stage/functions/_middleware.js")
			< actions.indexOf("wrangler:pages deploy"),
	);
	assert.ok(
		actions.indexOf("write:/tmp/aside-stage/src/_aside/private-publish-data.js")
			< actions.indexOf("wrangler:pages deploy"),
	);
	assert.equal(actions.at(-1), "rm:/tmp/aside-stage");
});

test("deployPublicHtmlSnapshotToWranglerPages preserves the static-only deploy layout", async () => {
	resetResolvedWranglerExecutionEnvForTests();
	const writeCalls: string[] = [];
	const deployCalls: Array<{
		args: string[];
		cwd?: string;
	}> = [];
	const modules: PublicHtmlSnapshotDeployRuntimeModules = {
		childProcess: {
			execFile(_file, args, options, callback) {
				if (args[0] === "-lic") {
					callback(null, "/usr/local/bin:/usr/bin\n", "");
				} else {
					deployCalls.push({
						args,
						cwd: options.cwd,
					});
					callback(null, "success", "");
				}
				return createTrackedProcessStub();
			},
		},
		fsPromises: {
			async mkdtemp() {
				return "/tmp/static-stage";
			},
			async mkdir() {},
			async writeFile(targetPath) {
				writeCalls.push(targetPath);
			},
			async rm() {},
		},
		os: {
			tmpdir: () => "/tmp",
		},
		path: path.posix,
	};

	const result = await deployPublicHtmlSnapshotToWranglerPages(modules, {
		files: [{
			vaultRelativePath: "public/page.html",
			contents: "<!doctype html><html><body>Page</body></html>",
		}],
		projectName: "publish-site",
		vaultRootPath: "/Users/test/vault",
		env: {
			SHELL: "/bin/zsh",
		},
	});

	assert.deepEqual(result, { ok: true });
	assert.deepEqual(writeCalls, ["/tmp/static-stage/public/page.html"]);
	assert.deepEqual(deployCalls.at(-1), {
		args: ["pages", "deploy", "/tmp/static-stage", "--project-name", "publish-site"],
		cwd: "/Users/test/vault",
	});
});
