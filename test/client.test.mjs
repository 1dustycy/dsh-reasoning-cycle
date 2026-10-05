/**
 * Deterministic suite for the reasoning-cycle bundle.
 *
 * The bundle is a browser factory, so the suite hands it the same globals the
 * Web shell does — a `window.__ModuleLoader__.load` collector — and then drives
 * the exported factory with a fake client context. Nothing here needs a real
 * DSH profile, the app, or a browser: the ring, the resolver, and the selection
 * it commits are all observable through the fake services.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read the shipped bundle and return the registration the shell would collect. */
function loadBundle() {
	const source = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	const registrations = [];
	const window = {
		__ModuleLoader__: {
			load(registration) {
				registrations.push(registration);
			}
		}
	};
	new Function("window", source)(window);
	assert.equal(registrations.length, 1, "the bundle registers exactly one factory");
	const registration = registrations[0];
	assert.equal(registration.id, "dsh-reasoning-cycle", "the bundle registers under its package name");
	return registration.factory(() => {
		throw new Error("the reasoning-cycle bundle must not require sibling modules");
	});
}

/** One recorded `directory.select` call. */
const selections = [];

/** A model directory double carrying just the surface the gesture reads and writes. */
function fakeDirectory(selection, pending = null) {
	return {
		store: {
			getSnapshot: () => ({
				current: selection,
				pending
			})
		},
		select(input) {
			selections.push(input);
			return Promise.resolve({
				ok: true,
				value: void 0
			});
		}
	};
}

/**
 * A client context double.
 * @param root0 - the directory's current/pending selection pair, what the catalog advertises, and the Session list shape.
 */
function fakeContext({ selection = null, pending = null, reasoning, sessionId = "s-1", throws = false } = {}) {
	const directory = fakeDirectory(selection, pending);
	const services = {
		sessions: {
			list: {
				getSnapshot: () => ({
					byId: sessionId === null ? {} : {
						[sessionId]: {
							id: sessionId,
							retainedBy: { mainView: 1 }
						}
					}
				})
			}
		},
		modelDirectories: {
			directoryFor() {
				if (throws) throw new Error("ui-model-selection: session resolved no scope");
				return directory;
			},
			catalog: { reasoningFor: () => reasoning }
		},
		shortcuts: {
			registered: [],
			register(command) {
				this.registered.push(command);
				return () => {};
			}
		},
		locale: {
			registered: {},
			register(namespace, dictionaries) {
				this.registered[namespace] = dictionaries;
				return () => {};
			},
			bind: () => (key) => key
		}
	};
	const ctx = {
		...services,
		get: (name) => services[name],
		effect: (body) => body()
	};
	return { ctx, directory, services };
}

/** A model that declares the levels DeepSeek's adapters typically advertise. */
const REASONING = {
	defaultEffort: "high",
	efforts: [
		{ id: "low", name: "Low" },
		{ id: "high", name: "High" },
		{ id: "max", name: "Max" }
	]
};

/** Run the command's resolver the way the registry does and report the outcome. */
function press(ctx, command) {
	const resolution = command.resolve({
		region: "editable",
		modal: null,
		target: null
	});
	if (resolution.status !== "handled") return resolution;
	resolution.run();
	return resolution;
}

const cycle = loadBundle();

// --- the ring ---------------------------------------------------------------

assert.deepEqual(cycle.reasoningRing(REASONING.efforts), [
	void 0,
	"low",
	"high",
	"max"
], "the provider default leads the ring, then the declared levels in menu order");

assert.deepEqual(cycle.reasoningRing(undefined), [void 0], "a model with no reasoning metadata still has the provider-default step");
assert.deepEqual(cycle.reasoningRing([]), [void 0], "an empty effort list is the same as no metadata");
assert.deepEqual(cycle.reasoningRing([
	{ id: "high", name: "High" },
	{ name: "broken" },
	null,
	{ id: "", name: "empty" }
]), [
	void 0,
	"high"
], "levels without a usable id are skipped rather than becoming ring positions");

// --- one step ---------------------------------------------------------------

const ring = cycle.reasoningRing(REASONING.efforts);
assert.deepEqual(cycle.nextReasoningStep(ring, void 0), { effort: "low" }, "the provider default advances to the first level");
assert.deepEqual(cycle.nextReasoningStep(ring, "low"), { effort: "high" }, "levels advance in declared order");
assert.deepEqual(cycle.nextReasoningStep(ring, "max"), { effort: void 0 }, "the last level wraps back to the provider default");
assert.deepEqual(cycle.nextReasoningStep(ring, "medium"), { effort: "low" }, "an effort the model no longer declares advances to the first level");
assert.equal(cycle.nextReasoningStep([void 0], void 0), void 0, "a model with no declared level has nowhere to advance");
assert.deepEqual(cycle.nextReasoningStep([void 0, "max"], "max"), { effort: void 0 }, "a single-level model still wraps");

// --- the command ------------------------------------------------------------

{
	const { ctx, services } = fakeContext({
		selection: {
			provider: "deepseek-account",
			model: "deepseek-flash",
			reasoningEffort: "high"
		},
		reasoning: REASONING
	});
	cycle.apply(ctx);
	const [command] = services.shortcuts.registered;
	assert.equal(command.id, "model.reasoning.cycle", "the command id is the published one");
	assert.deepEqual(command.defaults, {
		"desktop:macos": {
			code: "Tab",
			modifiers: ["shift"]
		},
		"desktop:windows": {
			code: "Tab",
			modifiers: ["shift"]
		}
	}, "only the two shift-only surfaces carry a default binding");
	assert.deepEqual(Object.keys(services.locale.registered), ["shortcuts.reasoningCycle"], "the label comes from this plugin's own namespace");
	assert.equal(command.label(), "cycle", "the label resolves through the bound namespace");
}

{
	selections.length = 0;
	const { ctx } = fakeContext({
		selection: {
			provider: "deepseek-account",
			model: "deepseek-flash",
			reasoningEffort: "high"
		},
		reasoning: REASONING
	});
	cycle.apply(ctx);
	const [command] = ctx.get("shortcuts").registered;
	assert.equal(press(ctx, command).status, "handled", "a model with levels handles the gesture");
	assert.deepEqual(selections, [{
		provider: "deepseek-account",
		model: "deepseek-flash",
		reasoningEffort: "max"
	}], "the step after high is max, on the same provider and model");
}

{
	selections.length = 0;
	const { ctx } = fakeContext({
		selection: {
			provider: "deepseek-account",
			model: "deepseek-flash",
			reasoningEffort: "max"
		},
		reasoning: REASONING
	});
	cycle.apply(ctx);
	press(ctx, ctx.get("shortcuts").registered[0]);
	assert.deepEqual(selections, [{
		provider: "deepseek-account",
		model: "deepseek-flash"
	}], "wrapping past the last level asks for the provider default by omitting the field");
}

{
	selections.length = 0;
	const { ctx } = fakeContext({
		selection: {
			provider: "xiaomi",
			model: "mimo-v2.6-pro",
			reasoningEffort: "off"
		},
		reasoning: {
			efforts: [
				{ id: "off", name: "Off" },
				{ id: "high", name: "High" }
			]
		}
	});
	cycle.apply(ctx);
	press(ctx, ctx.get("shortcuts").registered[0]);
	assert.deepEqual(selections, [{
		provider: "xiaomi",
		model: "mimo-v2.6-pro",
		reasoningEffort: "high"
	}], "a model whose first level is off still cycles to the next declared level");
}

{
	selections.length = 0;
	const { ctx } = fakeContext({
		selection: {
			provider: "deepseek-account",
			model: "deepseek-flash"
		},
		reasoning: REASONING
	});
	cycle.apply(ctx);
	press(ctx, ctx.get("shortcuts").registered[0]);
	assert.deepEqual(selections, [{
		provider: "deepseek-account",
		model: "deepseek-flash",
		reasoningEffort: "max"
	}], "a selection with no stored effort stands where its declared default does, and advances from there");
}

{
	selections.length = 0;
	const { ctx } = fakeContext({
		selection: {
			provider: "deepseek-account",
			model: "deepseek-flash",
			reasoningEffort: "low"
		},
		pending: {
			provider: "deepseek-account",
			model: "deepseek-flash",
			reasoningEffort: "high"
		},
		reasoning: REASONING
	});
	cycle.apply(ctx);
	press(ctx, ctx.get("shortcuts").registered[0]);
	assert.deepEqual(selections, [{
		provider: "deepseek-account",
		model: "deepseek-flash",
		reasoningEffort: "max"
	}], "an unsettled pick is the tip of the chain, so a quick second press does not repeat the first step");
}

// --- the no-op and failure paths --------------------------------------------

{
	selections.length = 0;
	const { ctx } = fakeContext({
		selection: {
			provider: "deepseek-account",
			model: "deepseek-non-reasoning"
		}
	});
	cycle.apply(ctx);
	const resolution = press(ctx, ctx.get("shortcuts").registered[0]);
	assert.equal(resolution.status, "blocked", "a model with no declared level blocks instead of committing a no-op");
	assert.equal(selections.length, 0, "a blocked gesture selects nothing");
}

{
	selections.length = 0;
	const { ctx } = fakeContext();
	cycle.apply(ctx);
	const resolution = press(ctx, ctx.get("shortcuts").registered[0]);
	assert.equal(resolution.status, "blocked", "no selected model blocks the gesture");
	assert.equal(selections.length, 0, "no selected model selects nothing");
}

{
	selections.length = 0;
	const { ctx } = fakeContext({
		selection: {
			provider: "deepseek-account",
			model: "deepseek-flash",
			reasoningEffort: "low"
		},
		reasoning: REASONING,
		sessionId: null
	});
	cycle.apply(ctx);
	const resolution = press(ctx, ctx.get("shortcuts").registered[0]);
	assert.equal(resolution.status, "blocked", "no Session holding the main view blocks the gesture");
	assert.equal(selections.length, 0, "no addressable Session selects nothing");
}

{
	selections.length = 0;
	const { ctx } = fakeContext({
		selection: {
			provider: "deepseek-account",
			model: "deepseek-flash",
			reasoningEffort: "low"
		},
		reasoning: REASONING,
		throws: true
	});
	cycle.apply(ctx);
	const resolution = press(ctx, ctx.get("shortcuts").registered[0]);
	assert.equal(resolution.status, "blocked", "an unaddressable Session blocks rather than throwing through the key handler");
	assert.equal(selections.length, 0, "an unaddressable Session selects nothing");
}

// --- the plugin contract ----------------------------------------------------

assert.deepEqual(cycle.inject, [
	"shortcuts",
	"sessions",
	"modelDirectories",
	"locale"
], "the declared services are the ones the gesture reads");
assert.equal(typeof cycle.apply, "function", "the client half applies a plugin body");

console.log("reasoning-cycle: ring, steps, command, and failure paths passed");
