import * as assert from "node:assert/strict";
import test from "node:test";
import {
	buildPublishPublicUrl,
} from "../src/core/publish/publishPath";

const exampleRelativePath = "share/BESS Fire and Toxic Gas Safety Spec.zh.html";

test("buildPublishPublicUrl preserves path segments and encodes spaces", () => {
	assert.equal(
		buildPublishPublicUrl({
			baseUrl: "https://publish.example.com",
			vaultRelativePath: exampleRelativePath,
		}),
		"https://publish.example.com/share/BESS%20Fire%20and%20Toxic%20Gas%20Safety%20Spec.zh.html",
	);
});
