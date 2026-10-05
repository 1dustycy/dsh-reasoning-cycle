window.__ModuleLoader__.load({
	id: "dsh-reasoning-cycle",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * Shift+Tab cycles the current Session's reasoning effort.
		 *
		 * The ring is derived per keystroke from the Host's own model metadata
		 * (`ctx.modelDirectories`), in the order the composer's model menu shows:
		 * the levels the selected model declares, and — only when that default is
		 * *not* itself a declared level — a leading provider-default stop. The step
		 * after the last one wraps to the first, so the shortcut is a ring, never a
		 * one-way ratchet. See {@link reasoningSteps} for why the provider-default
		 * stop is dropped when it is redundant.
		 *
		 * Selection rides the same `ModelDirectory.select` the model menu uses, so
		 * the effort lands in the Session projection exactly as a menu pick does —
		 * this plugin owns no second copy of the choice, and never talks to the
		 * Host's RPC surface itself.
		 *
		 * The binding declares defaults only for `desktop:macos` and
		 * `desktop:windows`, the two surfaces whose shortcut registry admits a
		 * shift-only gesture. Everywhere else the command stays registered but
		 * unbound, so the row still appears in Settings → Shortcuts and the user
		 * can assign it there.
		 */

		/** Shortcut command id; owned by this plugin and stable across versions. */
		const COMMAND_ID = "model.reasoning.cycle";
		/** Locale namespace holding this command's label. */
		const LOCALE_NAMESPACE = "shortcuts.reasoningCycle";

		/** The two surfaces that admit a shift-only gesture. */
		const SHIFT_TAB_DEFAULT = {
			code: "Tab",
			modifiers: ["shift"]
		};

		/**
		 * Enumerate the distinct stops of one model's ring, in menu order.
		 *
		 * The provider default — "no effort instruction, let the adapter decide" —
		 * is a stop only when it is *not* one of the declared levels. A model whose
		 * `defaultEffort` is itself a declared level ("high") resolves that stop to
		 * the same level it already lists, and keeping both would put two adjacent
		 * ring positions on one level: the gesture would move from `max` to the
		 * provider default and land back on `high`, which reads as a two-level
		 * toggle no matter how many levels the model declares.
		 *
		 * So the stop is dropped exactly when it is redundant, and the ring becomes
		 * the declared levels. The first stop is `undefined` (the provider default)
		 * or the first declared level, whichever applies.
		 * @param efforts - levels the selected model declares, in menu order.
		 * @param defaultEffort - the level the adapter would use with no instruction.
		 * @returns one entry per stop; `effort` is `undefined` only for a provider default outside the declared levels.
		 */
		function reasoningSteps(efforts, defaultEffort) {
			const declared = (Array.isArray(efforts) ? efforts : []).flatMap((level) => level !== null && typeof level === "object" && typeof level.id === "string" && level.id !== "" ? [level.id] : []);
			if (declared.length === 0) return [{ effort: void 0 }];
			if (typeof defaultEffort === "string" && declared.includes(defaultEffort)) return declared.map((effort) => ({ effort }));
			return [{ effort: void 0 }, ...declared.map((effort) => ({ effort }))];
		}

		/**
		 * Pick the stop after the current one.
		 *
		 * A current value the model no longer declares (a retained effort from a
		 * previous model) is not a ring position: it advances to the first stop,
		 * which is what the user means by "switch level" when the level in hand no
		 * longer exists.
		 *
		 * The answer is an object, not the bare effort, because `undefined` is itself
		 * a stop — the provider default — and "advance to the provider default" and
		 * "this model declares no level to advance to" must not collapse into one
		 * value.
		 * @param steps - stops from {@link reasoningSteps}.
		 * @param current - the effort in effect, or `undefined` for the provider default.
		 * @returns the next stop, or `undefined` when there is nowhere to advance.
		 */
		function nextStep(steps, current) {
			if (steps.length === 0) return void 0;
			const index = steps.findIndex((step) => step.effort === current);
			return index === -1 ? steps[0] : steps[(index + 1) % steps.length];
		}

		/**
		 * The Session this gesture acts on: the one the main view retains.
		 * @param sessions - the client Session service.
		 * @returns its id, or `undefined` when no Session holds the main view.
		 */
		function currentSessionId(sessions) {
			const summary = Object.values(sessions.list.getSnapshot().byId).find((row) => (row.retainedBy.mainView ?? 0) > 0);
			return summary?.id;
		}

		/**
		 * The Session's shared model directory, addressing the current Session.
		 * @param ctx - client root context.
		 * @returns the directory, or `undefined` when it cannot be addressed.
		 */
		function directoryOf(ctx) {
			const sessionId = currentSessionId(ctx.get("sessions"));
			if (sessionId === void 0) return void 0;
			try {
				return ctx.get("modelDirectories").directoryFor(sessionId);
			} catch (error) {
				return void 0;
			}
		}

		/**
		 * Read the selection in effect and its ring.
		 *
		 * An unsettled pick reads as the tip of the chain, not the settled value, so
		 * a second press moments after a first one advances from where the session
		 * is going rather than from where it still was.
		 * @param ctx - client root context.
		 * @param directory - the Session's model directory.
		 * @returns the effective selection's effort and ring; `undefined` when no model is selected.
		 */
		function stateOf(ctx, directory) {
			const snapshot = directory.store.getSnapshot();
			const selection = snapshot.pending ?? snapshot.current;
			if (selection === null || selection === void 0) return void 0;
			const reasoning = ctx.get("modelDirectories").catalog.reasoningFor(selection);
			return {
				selection,
				reasoning,
				effort: selection.reasoningEffort ?? reasoning?.defaultEffort,
				steps: reasoningSteps(reasoning?.efforts, reasoning?.defaultEffort)
			};
		}

		/**
		 * Plan one step of the ring: what the next press commits, or nothing when it
		 * could only commit a no-op.
		 * @param ctx - client root context.
		 * @returns the plan plus the inputs it was derived from; `undefined` when the gesture cannot act.
		 */
		function planStep(ctx) {
			const directory = directoryOf(ctx);
			if (directory === void 0) return void 0;
			const state = stateOf(ctx, directory);
			if (state === void 0) return void 0;
			const next = nextStep(state.steps, state.effort);
			// A ring with one stop wraps onto itself; a second Select of the level
			// already in effect is not a step, it is a no-op the user should not pay
			// an RPC for.
			if (next === void 0 || next.effort === state.effort) return void 0;
			return {
				selection: state.selection,
				reasoning: state.reasoning,
				steps: state.steps,
				effort: state.effort,
				next: next.effort,
				run: () => {
					directory.select({
						provider: state.selection.provider,
						model: state.selection.model,
						...next.effort === void 0 ? {} : { reasoningEffort: next.effort }
					}).catch((error) => {
						console.error("reasoning cycle: effort selection failed", error);
					});
				}
			};
		}

		/** Required services: the command registry, Session list, and model directories. */
		const inject = [
			"shortcuts",
			"sessions",
			"modelDirectories",
			"locale"
		];

		/**
		 * Client plugin body: register the Shift+Tab command.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, {
				zh: {
					cycle: "切换推理等级",
					unavailable: "当前会话没有可切换的推理等级"
				},
				en: {
					cycle: "Cycle reasoning effort",
					unavailable: "The current session has no reasoning level to switch"
				}
			}), "reasoning cycle: command label");
			const t = ctx.locale.bind(LOCALE_NAMESPACE);
			ctx.effect(() => ctx.shortcuts.register({
				id: COMMAND_ID,
				label: () => t("cycle"),
				aliases: [
					"reasoning",
					"effort",
					"thinking level",
					"推理等级",
					"思考等级"
				],
				defaults: {
					"desktop:macos": SHIFT_TAB_DEFAULT,
					"desktop:windows": SHIFT_TAB_DEFAULT
				},
				regions: [
					"page",
					"editable",
					"terminal"
				],
				modals: [],
				resolve: () => {
					const plan = planStep(ctx);
					return plan === void 0 ? {
						status: "blocked",
						reason: t("unavailable")
					} : {
						status: "handled",
						run: plan.run
					};
				}
			}), "reasoning cycle: Shift+Tab");
		}

		/** Exposed for the deterministic suite; the bundle itself only needs `apply`. */
		exports.COMMAND_ID = COMMAND_ID;
		exports.LOCALE_NAMESPACE = LOCALE_NAMESPACE;
		exports.reasoningSteps = reasoningSteps;
		exports.nextStep = nextStep;
		exports.planStep = planStep;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
