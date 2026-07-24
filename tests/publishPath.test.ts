import * as assert from "node:assert/strict";
import test from "node:test";
import {
	buildPublishPublicUrl,
} from "../src/core/publish/publishPath";

const exampleRelativePath = "share/BESS Fire and Toxic Gas Safety Spec.zh.html";

test("buildPublishPublicUrl emits clean html urls and encodes spaces", () => {
	assert.equal(
		buildPublishPublicUrl({
			baseUrl: "https://publish.example.com",
			vaultRelativePath: exampleRelativePath,
		}),
		"https://publish.example.com/share/BESS%20Fire%20and%20Toxic%20Gas%20Safety%20Spec.zh",
	);
});

test("buildPublishPublicUrl emits clean html urls with reserved characters encoded", () => {
	assert.equal(
		buildPublishPublicUrl({
			baseUrl: "https://publish.example.com/",
			vaultRelativePath: "public/Who’s making the most money in AI? It’s not who you think.html",
		}),
		"https://publish.example.com/public/Who%E2%80%99s%20making%20the%20most%20money%20in%20AI%3F%20It%E2%80%99s%20not%20who%20you%20think",
	);
});

test("buildPublishPublicUrl preserves non-html artifact extensions", () => {
	assert.equal(
		buildPublishPublicUrl({
			baseUrl: "https://publish.example.com",
			vaultRelativePath: "public/Wenqing Li Resume.pdf",
		}),
		"https://publish.example.com/public/Wenqing%20Li%20Resume.pdf",
	);
});

test("buildPublishPublicUrl treats htm artifacts as clean html urls", () => {
	assert.equal(
		buildPublishPublicUrl({
			baseUrl: "https://publish.example.com",
			vaultRelativePath: "public/archive.htm",
		}),
		"https://publish.example.com/public/archive",
	);
});
