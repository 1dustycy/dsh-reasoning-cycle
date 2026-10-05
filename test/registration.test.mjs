/**
 * The contract test: this plugin's command must be admissible to the *real*
 * shortcut registry the app ships, not merely to this repo's idea of one.
 *
 * The registry (`@deepseek-ai/dsh-client-shortcuts`) is a shipped bundle, so
 * the suite loads it from the installed DSH application instead of vendoring a
 * copy — a copy would drift, and this test exists precisely to catch a binding
 * the shipped validator rejects. It also reproduces the one validation the
 * registry's own `register()` performs for every runtime/platform pair.
 *
 * The suite skips (loudly) when the app is not installed, so the repo stays
 * runnable anywhere while a machine with DSH installed gets the real check.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Default install location of the macOS application carrying the shipped bundles. */
const APP_ASAR = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar";
/** Bundle path of the shipped shortcut registry inside the archive. */
const REGISTRY_PATH = "dsh/node_modules/@deepseek-ai/dsh-client-shortcuts/lib/client.js";
/** Bundles the registry bundle requires; the suite supplies inert doubles because the shipped bodies cannot run in Node. */
const SIBLING_REQUIRES = [
	"@deepseek-ai/cordis",
	"@deepseek-ai/dsh-client-store",
	"@deepseek-ai/dsh-client-ui-primitives"
];

/**
 * The registry's store surface, reimplemented in a dozen lines: the shipped
 * `createSnapshotStore` is only reached by `getSnapshot`, `set`, and
 * `subscribe` in this file.
 * @param value - initial snapshot.
 * @returns a snapshot store double.
 */
function snapshotStore(value) {
	let current = value;
	const listeners = new Set();
	return {
		getSnapshot: () => current,
		set: (next) => {
			current = next;
			for (const listener of [...listeners]) listener(current);
		},
		update: (mutate) => {
			mutate(current);
			for (const listener of [...listeners]) listener(current);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

/**
 * The sibling doubles the shipped registry bundle resolves at factory time.
 * Only `Service` is load-bearing: the shipped bundle subclasses it.
 * @param specifier - the required module name.
 * @returns the double for that module.
 */
function siblingDouble(specifier) {
	if (!SIBLING_REQUIRES.includes(specifier)) throw new Error(`unexpected require("${specifier}")`);
	if (specifier === "@deepseek-ai/cordis") return { Service: class Service {} };
	if (specifier === "@deepseek-ai/dsh-client-store") return { createSnapshotStore: snapshotStore };
	return {};
}

/**
 * Load this repo's client bundle the way the Web shell does.
 * @returns the bundle's exports.
 */
function loadPlugin() {
	const source = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
	const registrations = [];
	new Function("window", source)({
		__ModuleLoader__: {
			load: (registration) => registrations.push(registration)
		}
	});
	return registrations[0].factory(() => {
		throw new Error("the reasoning-cycle bundle must not require sibling modules");
	});
}

/**
 * Read one file out of an asar archive by walking its header.
 * @param archive - absolute archive path.
 * @param target - archive-relative file path.
 * @returns the file bytes, or `undefined` when the archive or entry is absent.
 */
function readFromAsar(archive, target) {
	if (!existsSync(archive)) return void 0;
	const buffer = readFileSync(archive);
	const jsonSize = buffer.readUInt32LE(12);
	const header = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString("utf8"));
	let node = header;
	for (const part of target.split("/")) {
		node = node.files?.[part];
		if (node === void 0) return void 0;
	}
	if (node.files !== void 0) return void 0;
	const start = 16 + jsonSize + Number(node.offset);
	return buffer.subarray(start, start + node.size);
}

/**
 * Load the shipped registry bundle and hand back its `ShortcutRegistry` class.
 *
 * The bundle exports the Cordis service, not the registry, and the registry
 * needs the DOM the service installs against. Rather than stage a browser, the
 * loader makes one named capture — `globalThis.__dshShippedShortcutRegistry =
 * ShortcutRegistry` — inside the factory's own scope, right before it returns.
 * Everything else about the factory is the shipped bytes: this exercises the
 * real `normalizeBinding` / `bindingIssue` / `dispatch`, which is the point.
 * @returns the class, or `undefined` when the app is not installed here.
 */
function loadShippedRegistry() {
	let source = readFromAsar(APP_ASAR, REGISTRY_PATH);
	if (source === void 0) return void 0;
	if (source[0] === 0x82 && source[1] === 0x0a) source = source.subarray(2);
	const code = source.toString("utf8").replace("\t\tmodule.exports = ShortcutsService;", "\t\tglobalThis.__dshShippedShortcutRegistry = ShortcutRegistry;\n\t\tmodule.exports = ShortcutsService;");
	if (code === source.toString("utf8")) throw new Error("the shipped registry bundle changed shape: its export line is gone");
	const registrations = [];
	new Function("window", "require", code)({
		__ModuleLoader__: {
			load: (registration) => registrations.push(registration)
		}
	}, siblingDouble);
	registrations[0].factory(siblingDouble);
	const registry = globalThis.__dshShippedShortcutRegistry;
	delete globalThis.__dshShippedShortcutRegistry;
	return registry;
}

/**
 * A client context double: the services `apply()` touches, plus the live
 * Session list and model directory a gesture resolves against.
 *
 * One object serves as both the plugin context and the dispatch context
 * (`region`, `modal`, `target`) because this suite drives the plugin's own
 * resolver — the one registered by `apply()` — rather than reconstructing it.
 * @param registered - collector for the command `apply()` registers.
 * @param selection - the settled selection the gesture reads.
 * @param reasoning - what the catalog advertises for that selection.
 * @returns the context plus a log of committed selections.
 */
function contextFor(selection, reasoning, { registered = [] } = {}) {
	const committed = [];
	const services = {
		shortcuts: {
			register(command) {
				registered.push(command);
				return () => {};
			}
		},
		sessions: {
			list: {
				getSnapshot: () => ({
					byId: {
						"s-1": {
							id: "s-1",
							retainedBy: { mainView: 1 }
						}
					}
				})
			}
		},
		modelDirectories: {
			directoryFor: () => ({
				store: {
					getSnapshot: () => ({
						current: selection,
						pending: null
					})
				},
				select: (input) => {
					committed.push(input);
					return Promise.resolve({
						ok: true,
						value: void 0
					});
				}
			}),
			catalog: { reasoningFor: () => reasoning }
		},
		locale: {
			register: () => () => {},
			bind: () => (key) => key
		}
	};
	const ctx = {
		...services,
		region: "editable",
		modal: null,
		target: null,
		get: (name) => services[name],
		effect(body) {
			return body();
		}
	};
	return { cx: ctx, registered, committed };
}

/**
 * Register this plugin's own command with the shipped registry, exactly as the
 * app does — the command object, its defaults, and its resolver all come from
 * the plugin, so nothing about the assertion is a copy that can drift.
 * @param registryClass - the shipped `ShortcutRegistry`.
 * @param selection - the settled selection the gesture reads.
 * @param reasoning - what the catalog advertises for that selection.
 * @returns the registered command, its registry, and the plugin context.
 */
function registerWithShipped(registryClass, selection, reasoning) {
	const { cx, registered, committed } = contextFor(selection, reasoning);
	plugin.apply(cx);
	const [command] = registered;
	assert.equal(registered.length, 1, "apply registers exactly one command");
	const registry = new registryClass("desktop", "macos");
	registry.register(command);
	return {
		command,
		registry,
		committed
	};
}

const plugin = loadPlugin();
const ShortcutRegistry = loadShippedRegistry();

if (ShortcutRegistry === void 0) {
	console.log(`reasoning-cycle: SKIPPED the shipped-registry contract — ${APP_ASAR} is not installed on this machine`);
} else {
	const SELECTION = {
		provider: "deepseek-account",
		model: "deepseek-flash",
		reasoningEffort: "high"
	};
	const REASONING = {
		defaultEffort: "high",
		efforts: [
			{ id: "low", name: "Low" },
			{ id: "high", name: "High" },
			{ id: "max", name: "Max" }
		]
	};

	// The command the plugin actually registers is admissible to the shipped registry.
	const { command, registry, committed } = registerWithShipped(ShortcutRegistry, SELECTION, REASONING);
	const row = registry.catalog.getSnapshot().find((entry) => entry.id === plugin.COMMAND_ID);
	assert.equal(row.binding.code, "Tab", "the resolved binding is Tab");
	assert.deepEqual(row.binding.modifiers, ["shift"], "the resolved binding carries no modifier but shift");
	assert.equal(row.issue, null, "the shipped registry reports no issue with the binding");
	assert.deepEqual(row.conflicts, [], "the shipped registry reports no conflict with an existing command");
	assert.deepEqual(row.keys, ["⇧", "Tab"], "the settings row renders the keycaps the user expects");

	// A gesture matching that default reaches the plugin's own resolver, which
	// commits the effort the ring dictates for the selection in effect.
	const handled = registry.dispatch({
		code: "Tab",
		control: false,
		alt: false,
		shift: true,
		meta: false,
		repeat: false,
		composing: false,
		defaultPrevented: false
	}, {
		region: "editable",
		modal: null,
		target: null
	}, () => {});
	assert.equal(handled.status, "handled", "a shift+tab gesture dispatches to the command");
	assert.equal(handled.commandId, plugin.COMMAND_ID, "the gesture routes to this command, not another row");
	assert.deepEqual(committed, [{
		provider: "deepseek-account",
		model: "deepseek-flash",
		reasoningEffort: "max"
	}], "the dispatched gesture commits the next level, not merely a canned run");

	// A shift-only default is admissible exactly where the plugin declares one.
	for (const [runtime, platform] of [
		["desktop", "macos"],
		["desktop", "windows"]
	]) {
		const probe = `${plugin.COMMAND_ID}.${runtime}.${platform}`;
		assert.ok(command.defaults[`${runtime}:${platform}`] !== void 0, `the plugin declares a default for ${runtime}:${platform}`);
		assert.doesNotThrow(() => new ShortcutRegistry(runtime, platform).register({
			...command,
			id: probe,
			defaults: {
				[`${runtime}:${platform}`]: command.defaults[`${runtime}:${platform}`]
			}
		}), `${runtime}:${platform} admits the declared shift-only binding`);
	}

	// ...and nowhere else, which is why the other surfaces carry no default.
	for (const [runtime, platform] of [
		["desktop", "linux"],
		["web", "macos"],
		["web", "windows"]
	]) {
		const probe = `${plugin.COMMAND_ID}.${runtime}.${platform}`;
		assert.equal(command.defaults[`${runtime}:${platform}`], void 0, `the plugin declares no default for ${runtime}:${platform}`);
		assert.throws(() => new ShortcutRegistry(runtime, platform).register({
			...command,
			id: probe,
			defaults: {
				[`${runtime}:${platform}`]: {
					code: "Tab",
					modifiers: ["shift"]
				}
			}
		}), /Unsupported Web shortcut|Reserved shortcut default/u, `${runtime}:${platform} rejects a shift-only default, which is why none ships`);
	}

	console.log("reasoning-cycle: shipped shortcut registry accepted the plugin's own command and routed shift+tab through its resolver");
}
