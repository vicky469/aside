import type { BrokerEnv } from "../src/index";

declare module "cloudflare:test" {
	interface ProvidedEnv extends BrokerEnv {}
}
