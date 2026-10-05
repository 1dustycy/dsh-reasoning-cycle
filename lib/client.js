window.__ModuleLoader__.load({
	id: "dsh-reasoning-cycle",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * Shift+Tab cycles the current Session's reasoning effort.
		 *
		 * The cycle is derived per keystroke from the Host's own model metadata
		 * (`ctx.modelDirectories`): the provider default comes first, then every
		 * level the selected model declares, ascending — the order the effort list
		 * in the composer's model menu already shows. The step after the last
		 * level wraps back to the provider default, so the shortcut is a ring,
		 * never a one-way ratchet.
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
		 * Enumerate the ring of selectable steps for one model selection.
		 *
		 * `undefined` is the provider default — "no effort instruction, let the
		 * adapter decide" — which is a real and reachable state, not an absence of
		 * a value. It leads every ring, matching the effort menu.
		 * @param efforts - levels the selected model declares, in menu order.
		 * @returns one step per ring position; `undefined` is the provider default.
		 */
		function reasoningRing(efforts) {
			const declared = Array.isArray(efforts) ? efforts : [];
			const ids = declared.flatMap((level) => level !== null && typeof level === "object" && typeof level.id === "string" && level.id !== "" ? [level.id] : []);
			return [void 0, ...ids];
		}

		/**
		 * Pick the step after the current one.
		 *
		 * A current value the model no longer declares (a retained effort from a
		 * previous model) is not a ring position: it advances to the first declared
		 * level, which is what the user means by "switch level" when the level in
		 * hand no longer exists.
		 *
		 * The answer is an object, not the bare step, because `undefined` is itself a
		 * step — the provider default — and "advance to the provider default" and
		 * "this model declares no level to advance to" must not collapse into one
		 * value.
		 * @param ring - steps from {@link reasoningRing}.
		 * @param current - the effort in effect, or `undefined` for the provider default.
		 * @returns the next step, or `undefined` when the model declares no level.
		 */
		function nextReasoningStep(ring, current) {
			const declared = ring.slice(1);
			if (declared.length === 0) return void 0;
			const index = ring.indexOf(current);
			return { effort: index === -1 ? declared[0] : ring[(index + 1) % ring.length] };
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
				ring: reasoningRing(reasoning?.efforts)
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
			const next = nextReasoningStep(state.ring, state.effort);
			if (next === void 0) return void 0;
			return {
				selection: state.selection,
				reasoning: state.reasoning,
				ring: state.ring,
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
		 * Temporary diagnostic overlay: writes the ring this plugin computed, the
		 * level it believes is in effect, and the step it is about to commit into a
		 * fixed panel. It removes itself before the next press.
		 *
		 * This exists because the ring comes from Host metadata that is invisible
		 * from outside the app; when a press does not move the level the user sees,
		 * this panel is the difference between reading the metadata and guessing at
		 * it. Remove it once the ring is confirmed against the model menu.
		 * @param lines - the panel's text lines.
		 * @returns a disposer that detaches the panel.
		 */
		function debugPanel(lines) {
			if (typeof document === "undefined" || document.body === null) return () => {};
			const existing = document.getElementById("dsh-reasoning-cycle-debug");
			if (existing !== null) existing.remove();
			const panel = document.createElement("pre");
			panel.id = "dsh-reasoning-cycle-debug";
			panel.textContent = lines.join("\n");
			panel.style.cssText = [
				"position:fixed",
				"right:16px",
				"bottom:16px",
				"z-index:2147483647",
				"margin:0",
				"padding:10px 12px",
				"max-width:60vw",
				"font:12px/1.5 ui-monospace,Menlo,monospace",
				"white-space:pre-wrap",
				"color:#fff",
				"background:rgba(20,20,24,.94)",
				"border:1px solid rgba(255,255,255,.25)",
				"border-radius:8px",
				"pointer-events:none"
			].join(";");
			document.body.appendChild(panel);
			return () => panel.remove();
		}

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
					// TEMPORARY: the ring comes from Host metadata that is invisible from
					// outside the app; this panel is how it gets read. Remove with debugPanel.
					debugPanel(plan === void 0 ? [
						"dsh-reasoning-cycle 诊断",
						"不动作：没有会话 / 没有选中模型 / 模型不声明等级"
					] : [
						"dsh-reasoning-cycle 诊断",
						`模型: ${plan.selection.provider}/${plan.selection.model}`,
						`保存的 reasoningEffort: ${JSON.stringify(plan.selection.reasoningEffort)}`,
						`目录 defaultEffort: ${JSON.stringify(plan.reasoning?.defaultEffort)}`,
						`目录声明的等级: ${JSON.stringify(plan.reasoning?.efforts?.map((level) => level.id))}`,
						`算出的环: ${JSON.stringify(plan.ring.map((step) => step ?? "(提供方默认)"))}`,
						`当前档: ${JSON.stringify(plan.effort ?? "(提供方默认)")}`,
						`下一档: ${JSON.stringify(plan.next ?? "(提供方默认)")}`
					]);
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
		exports.reasoningRing = reasoningRing;
		exports.nextReasoningStep = nextReasoningStep;
		exports.planStep = planStep;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
