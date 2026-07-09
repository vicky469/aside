import * as assert from "node:assert/strict";
import test from "node:test";
import {
	buildWranglerPagesDeployArgs,
	buildWranglerPagesDeployCommand,
	buildWranglerPagesProjectListArgs,
	findWranglerPagesProjectNameByPublishBaseUrl,
	resetResolvedWranglerExecutionEnvForTests,
	runWranglerPagesDeploy,
	summarizeWranglerFailure,
	type WranglerRuntimeModules,
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

test("buildWranglerPagesDeployArgs builds Pages deploy argv without shell interpolation", () => {
	assert.deepEqual(buildWranglerPagesDeployArgs({
		stagingDirPath: "/tmp/aside publish/stage",
		projectName: "publish-site",
	}), [
		"pages",
		"deploy",
		"/tmp/aside publish/stage",
		"--project-name",
		"publish-site",
	]);
});

test("buildWranglerPagesDeployCommand keeps command and arguments separate", () => {
	assert.deepEqual(buildWranglerPagesDeployCommand({
		stagingDirPath: "/tmp/stage; rm -rf /",
		projectName: "publish-site",
	}), {
		command: "wrangler",
		args: [
			"pages",
			"deploy",
			"/tmp/stage; rm -rf /",
			"--project-name",
			"publish-site",
		],
	});
});

test("buildWranglerPagesProjectListArgs requests JSON output", () => {
	assert.deepEqual(buildWranglerPagesProjectListArgs(), [
		"pages",
		"project",
		"list",
		"--json",
	]);
});

test("findWranglerPagesProjectNameByPublishBaseUrl matches custom project domains", () => {
	assert.equal(
		findWranglerPagesProjectNameByPublishBaseUrl("https://publish.fdechina.com", [{
			"Project Name": "fdechina-publish",
			"Project Domains": "fdechina-publish.pages.dev, publish.fdechina.com",
		}, {
			"Project Name": "fdechina",
			"Project Domains": "fdechina.pages.dev, fdechina.com",
		}]),
		"fdechina-publish",
	);
});

test("findWranglerPagesProjectNameByPublishBaseUrl skips default pages.dev origins", () => {
	assert.equal(
		findWranglerPagesProjectNameByPublishBaseUrl("https://fdechina-publish.pages.dev", [{
			"Project Name": "fdechina-publish",
			"Project Domains": "fdechina-publish.pages.dev, publish.fdechina.com",
		}]),
		null,
	);
});

test("runWranglerPagesDeploy invokes execFile with command and argv", async () => {
	resetResolvedWranglerExecutionEnvForTests();
	const capturedCalls: Array<{
		file: string;
		args: string[];
		cwd?: string;
		envPath?: string;
	}> = [];
	const modules: WranglerRuntimeModules = {
		childProcess: {
			execFile(file, args, options, callback) {
				capturedCalls.push({
					file,
					args,
					cwd: options.cwd,
					envPath: options.env?.PATH,
				});
				if (file === "wrangler") {
					callback(null, "success", "");
				} else {
					callback(Object.assign(new Error(`missing ${file}`), { code: "ENOENT" }), "", "");
				}
				return createTrackedProcessStub();
			},
		},
	};

	const result = await runWranglerPagesDeploy(modules, {
		stagingDirPath: "/tmp/stage",
		projectName: "publish-site",
		cwd: "/tmp/aside-example-vault",
	});

	assert.deepEqual(capturedCalls.at(-1), {
		file: "wrangler",
		args: ["pages", "deploy", "/tmp/stage", "--project-name", "publish-site"],
		cwd: "/tmp/aside-example-vault",
		envPath: undefined,
	});
	assert.deepEqual(result, {
		ok: true,
		projectName: "publish-site",
		stdout: "success",
		stderr: "",
	});
});

test("runWranglerPagesDeploy uses login shell PATH before invoking wrangler", async () => {
	resetResolvedWranglerExecutionEnvForTests();
	const capturedCalls: Array<{
		file: string;
		args: string[];
		cwd?: string;
		envPath?: string;
	}> = [];
	const modules: WranglerRuntimeModules = {
		childProcess: {
			execFile(file, args, options, callback) {
				capturedCalls.push({
					file,
					args,
					cwd: options.cwd,
					envPath: options.env?.PATH,
				});
				if (args[0] === "-lic") {
					callback(null, "shell banner\n/Users/test/.nvm/bin:/usr/bin\n", "");
				} else {
					callback(null, "success", "");
				}
				return createTrackedProcessStub();
			},
		},
	};

	const result = await runWranglerPagesDeploy(modules, {
		stagingDirPath: "/tmp/stage",
		projectName: "publish-site",
		cwd: "/Users/test/vault",
		env: {
			HOME: "/Users/test",
			PATH: "/usr/bin",
			SHELL: "/bin/zsh",
		},
	});

	assert.deepEqual(capturedCalls, [{
		file: "/bin/zsh",
		args: ["-lic", "printf '%s\\n' \"$PATH\""],
		cwd: "/Users/test",
		envPath: "/usr/bin",
	}, {
		file: "wrangler",
		args: ["pages", "deploy", "/tmp/stage", "--project-name", "publish-site"],
		cwd: "/Users/test/vault",
		envPath: "/Users/test/.nvm/bin:/usr/bin",
	}]);
	assert.deepEqual(result, {
		ok: true,
		projectName: "publish-site",
		stdout: "success",
		stderr: "",
	});
});

test("runWranglerPagesDeploy resolves custom-domain Pages projects before deploy", async () => {
	resetResolvedWranglerExecutionEnvForTests();
	const capturedCalls: Array<{
		file: string;
		args: string[];
		cwd?: string;
	}> = [];
	const modules: WranglerRuntimeModules = {
		childProcess: {
			execFile(file, args, options, callback) {
				capturedCalls.push({
					file,
					args,
					cwd: options.cwd,
				});
				if (args[0] === "-lic") {
					callback(null, "/usr/local/bin:/usr/bin\n", "");
				} else if (file === "wrangler" && args.join(" ") === "pages project list --json") {
					callback(null, JSON.stringify([{
						"Project Name": "fdechina-publish",
						"Project Domains": "fdechina-publish.pages.dev, publish.fdechina.com",
					}]), "");
				} else if (file === "wrangler") {
					callback(null, "success", "");
				} else {
					callback(Object.assign(new Error(`missing ${file}`), { code: "ENOENT" }), "", "");
				}
				return createTrackedProcessStub();
			},
		},
	};

	const result = await runWranglerPagesDeploy(modules, {
		stagingDirPath: "/tmp/stage",
		projectName: "publish-fdechina-com",
		publishBaseUrl: "https://publish.fdechina.com",
		cwd: "/Users/test/vault",
		env: {
			SHELL: "/bin/zsh",
		},
	});

	assert.deepEqual(capturedCalls.at(-1), {
		file: "wrangler",
		args: ["pages", "deploy", "/tmp/stage", "--project-name", "fdechina-publish"],
		cwd: "/Users/test/vault",
	});
	assert.deepEqual(result, {
		ok: true,
		projectName: "fdechina-publish",
		stdout: "success",
		stderr: "",
	});
});

test("summarizeWranglerFailure maps setup failures to concise user guidance", () => {
	assert.equal(
		summarizeWranglerFailure(Object.assign(new Error("spawn wrangler ENOENT"), { code: "ENOENT" }), "", ""),
		"Wrangler was not found. Install Wrangler and make sure `wrangler` is available on PATH.",
	);
	assert.equal(
		summarizeWranglerFailure(new Error("exit 1"), "", "Authentication error: not logged in"),
		"Wrangler is not logged in. Run `wrangler login`, then try publishing again.",
	);
	assert.equal(
		summarizeWranglerFailure(new Error("exit 1"), "", "Project not found: publish-site"),
		"Cloudflare Pages target was not found. Check your Cloudflare Pages project configuration.",
	);
});
