sap.ui.define([], function () { // ensures compatibility with UI5 system.

  let collectedLogs = [];

  function convertToTestSteps(receiveInput) {
      collectedLogs = [];
      console.log("Input:", receiveInput);
      const input = buildRequestPayload(receiveInput);
      const output = doTransformation(input.opa5Input, input);
      console.log('Output: ', output);
      return output;
  }

  function renderOutput(finalSteps) {
      const output = {
          logs: collectedLogs,
          steps: {testSteps: finalSteps}
      };
      return output;
  }

  const log = {
      info: (m) => { collectedLogs.push({ level: "info", msg: m }); },
      ok:   (m) => { collectedLogs.push({ level: "ok", msg: "✔ " + m }); },
      warn: (m) => { collectedLogs.push({ level: "warn", msg: "⚠ " + m }); },
      err:  (m) => { collectedLogs.push({ level: "err", msg: "✖ " + m }); }
  };
  
  var converterConfig = {
      global: {
        insertUi5HelperAtStart: true
      },
      initialSteps: [
        { type: "launch", enable: true, user_action: "Go to url", desc: "Launch Application", data: "{launchUrl}" },
        { type: "waitForElement", enable: true, user_action: "Wait", desc: "Wait for Element", locator: "USERNAME_FIELD-inner", data: "{waitAfterLaunchTime}" },
        { type: "setUser", enable: true, user_action: "Set", desc: "Set Username", locator: "USERNAME_FIELD-inner", data: "{loginUser}" },
        { type: "setPassword", enable: true, user_action: "Set", desc: "Set Password", locator: "PASSWORD_FIELD-inner", data: "{loginPass}" },
        { type: "clickLogin", enable: true, user_action: "Click", desc: "Click Log On", locator: "LOGIN_LINK", data: "{loginLink}" },
        { type: "wait", enable: true, user_action: "Wait", desc: "Wait After Login", data: "{waitAfterLoginTime}" }
      ],
      actions: {
        click: {
          replaceWith: "Execute Javascript",
          locatorType: "Id",
          stepProperty: "text",
          templateName: "ui5ClickButton"
        },
        input: {
          replaceWith: "Execute Javascript",
          locatorType: "Id",
          stepProperty: "text",
          templateName: "ui5SetValue"
        },
        wait: {
          replaceWith: "Execute Javascript",
          locatorType: "Id",
          stepProperty: "text"
        }
      },
      templates: {
        wait: {
          ui5Helper: `(function(){
            if (!window.sap || !sap.ui || !sap.ui.getCore) {
              console.error("%c❌ SAP UI5 not available on this page.", "color: red; font-weight: bold;");
              return;
            }
            // ============ ui5Helper =============
            window.ui5Helper = window.ui5Helper || {};
            (function(h){
              h._cfg = { poll: {{POLL}}, timeout: {{TIMEOUT}} };

              h._now = ()=>Date.now();
              h._sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
              h._busy = ()=> (sap.ui.core && sap.ui.core.BusyIndicator && sap.ui.core.BusyIndicator.oBusyIndicator) ? true : false;

              h._allElements = () => Object.values(sap.ui.getCore().mElements || {});
              h.findViewById = (id)=> sap.ui.getCore().byId(id);
              h.findViewByName = (viewName) => {
                const els = h._allElements();
                for (const el of els){
                  try {
                    if (el.getViewName && el.getViewName() === viewName) return el;
                  } catch(e){}
                }
                return null;
              };
              h._matchBinding = (ctrl, propPath, pathPrefix) => {
                try{
                  const ctx = ctrl.getBindingContext && ctrl.getBindingContext();
                  if (!ctx) return false;
                  const path = ctx.getPath && ctx.getPath();
                  if (!path || !path.startsWith(pathPrefix)) return false;
                  const binding = (ctrl.getBindingInfo && (ctrl.getBindingInfo("value") || ctrl.getBindingInfo("text") || ctrl.getBindingInfo("selectedKey")));
                  if (!binding) return false;
                  const parts = binding.parts || [];
                  return parts.some(p => p.path === propPath);
                }catch(e){ return false; }
              };
              h._matchProperties = (ctrl, props) => {
                if (!props) return true;
                try {
                  return Object.entries(props).every(([k,v])=>{
                    const getter = "get" + k.charAt(0).toUpperCase()+k.slice(1);
                    if (typeof ctrl[getter] !== "function") return false;
                    return String(ctrl[getter]()) === String(v);
                  });
                } catch(e){ return false; }
              };
              h._hasDescendant = (root, sel) => {
                let found = null;
                root.findAggregatedObjects(true, c=>{
                  if (h._selectorMatch(c, sel)) { found = c; return true; }
                  return false;
                });
                return !!found;
              };
              h._selectorMatch = (ctrl, sel) => {
                if (sel.controlType && !(ctrl.isA && ctrl.isA(sel.controlType))) return false;
                if (sel.bindingPath && !h._matchBinding(ctrl, sel.bindingPath.propertyPath, sel.bindingPath.path)) return false;
                if (sel.properties && !h._matchProperties(ctrl, sel.properties)) return false;
                return true;
              };
              h._roots = (includeDialogs) => {
                const roots = [];
                const els = h._allElements();
                for (const el of els){
                  try{
                    // collect top-level Views and Dialogs if requested
                    if (el.getViewName && !el.getParent) roots.push(el);
                    if (includeDialogs && (el.isA && (el.isA("sap.m.Dialog") || el.isA("sap.m.Popover")))) roots.push(el);
                  }catch(e){}
                }
                return roots;
              };

              h.waitForControlDom = async function(selector, timeout){
                const T = timeout || h._cfg.timeout;
                const start = h._now();
                const id = selector && selector.id;
                if (!id) throw new Error("waitForControlDom expects selector.id");
                while (true){
                  const ctrl = sap.ui.getCore().byId(id);
                  if (ctrl && ctrl.getDomRef && ctrl.getDomRef()){
                    console.log("✅ Control ready:", id);
                    return ctrl;
                  }
                  if (h._now() - start > T){
                    throw new Error("⏱ Timeout waiting for control " + id);
                  }
                  await h._sleep(h._cfg.poll);
                }
              };

              h.findBySelectorObject = function(selector){
                if (!selector) return null;
                // Direct byId
                if (selector.id){
                  return sap.ui.getCore().byId(selector.id);
                }
                // Find view by id or name (optional)
                let root = null;
                if (selector.viewId) root = sap.ui.getCore().byId(selector.viewId);
                if (!root && selector.viewName) root = h.findViewByName(selector.viewName);
                const searchRoots = [];
                if (root) searchRoots.push(root);
                // Optionally include dialogs/popovers
                for (const r of h._roots(!!selector.searchOpenDialogs)) {
                  if (!root || r === root) searchRoots.push(r);
                }
                // Deduplicate
                const uniq = Array.from(new Set(searchRoots));
                for (const R of uniq){
                  let candidate = null;
                  try {
                    R.findAggregatedObjects(true, c=>{
                      if (!h._selectorMatch(c, selector)) return false;
                      if (selector.descendant && !h._hasDescendant(c, selector.descendant)) return false;
                      candidate = c;
                      return true;
                    });
                  } catch(e){}
                  if (candidate) return candidate;
                }
                return null;
              };

              h.press = function(selOrId){
                let ctrl = null;
                if (typeof selOrId === "string") ctrl = sap.ui.getCore().byId(selOrId);
                else ctrl = h.findBySelectorObject(selOrId);
                if (!ctrl) { console.error("❌ press: control not found", selOrId); return false; }
                if (typeof ctrl.firePress === "function"){ ctrl.firePress(); return true; }
                if (typeof ctrl.fireSelect === "function"){ ctrl.fireSelect({}); return true; }
                if (typeof ctrl.fireTap === "function"){ ctrl.fireTap({}); return true; }
                console.warn("⚠ press: no press/select/tap on control; avoiding DOM click");
                return false;
              };

              h.setValue = function(opts){
                const { selector, value } = opts||{};
                let ctrl = null;
                if (!selector){ console.error("❌ setValue: missing selector"); return false; }
                if (selector.id){ ctrl = sap.ui.getCore().byId(selector.id); }
                if (!ctrl) ctrl = h.findBySelectorObject(selector);
                if (!ctrl || !ctrl.setValue){
                  console.error("❌ setValue: control not found or not an input", selector, ctrl);
                  return false;
                }
                try{
                  ctrl.setValue(value);
                  if (typeof ctrl.fireLiveChange === "function") ctrl.fireLiveChange({value});
                  if (typeof ctrl.fireChange === "function") ctrl.fireChange({value});
                  if (typeof ctrl.fireSubmit === "function") ctrl.fireSubmit({});
                  return true;
                }catch(e){
                  console.error("❌ setValue error:", e);
                  return false;
                }
              };
            })(window.ui5Helper);

            // ============ opa5Adapter (selector normalizer) ============
            window.opa5Adapter = window.opa5Adapter || {};
            (function(a,h){
              a.normalizeSelector = function(obj){
                // Return as-is; our helper understands OPA5-like structures.
                return obj || {};
              };
            })(window.opa5Adapter, window.ui5Helper);

            console.log("%c✅ Helpers injected: ui5Helper + opa5Adapter With Polling",  "color: green; font-weight: bold;");
          })();
          `,
          ui5SetValue: `return (async function () {
                if (!window.sap || !sap.ui || !sap.ui.getCore) {
                    return console.error("%c❌ SAP UI5 not available", "color: red; font-weight: bold;");
                }

                const stepNumber = "{{STEP_NUMBER}}";
                const viewId = "{{VIEW_ID}}";
                const pathPrefix = "{{PATH_PREFIX}}";
                const propToSet = "{{PROPERTY_PATH}}";
                const newValue = "{{NEW_VALUE}}";
                
                const timeoutMs = {{TIMEOUT}};
                const intervalMs = {{POLL}};
                const start = Date.now();

                let loopCount = 1;
                let executionLocator = '';
                function findTarget() {
                    let target = null;

                    if (viewId && !propToSet && !pathPrefix) {
                        executionLocator = "STABLE LOCATOR: ";
                        target = sap.ui.getCore().byId(viewId);
                    }

                    if (!target && viewId && propToSet && pathPrefix) {
                        executionLocator = "UNSTABLE LOCATOR: ";
                        const oView = sap.ui.getCore().byId(viewId);
                        if (oView) {
                            const inputs = oView.findAggregatedObjects(true, ctrl => ctrl.isA("sap.m.Input"));
                            target = inputs.find(input => {
                                const ctx = input.getBindingContext();
                                if (!ctx) return false;
                                const path = ctx.getPath();
                                if (!path.startsWith(pathPrefix)) return false;
                                const bindInfo = input.getBindingInfo("value");
                                return bindInfo && bindInfo.parts.some(p => p.path === propToSet);
                            });
                        }
                    }

                    console.info("Step:", stepNumber, executionLocator, newValue,  " TARGET: ", target, " Loop Level -> ", loopCount);
                    loopCount++;
                    return target;
                }

                let target = null;
                while (!(target = findTarget())) {
                    if (Date.now() - start > timeoutMs) {
                        console.error(
                          \`%cStep: \${stepNumber} ⏰ Timeout: Control not found\`,
                          "color: red; font-weight: bold;"
                        );
                        return;
                    }
                    await new Promise(r => setTimeout(r, intervalMs));
                }

                function setInputValueWithDetermination(ctrl, value) {
                  if (!ctrl) return;

                  if (ctrl.isA("sap.ui.comp.smartfield.SmartField")) {
                    const inner = ctrl.getFirstInnerControl?.()[0];
                    if (inner) {
                      return setInputValueWithDetermination(inner, value);
                    }
                  }

          if (ctrl.isA("sap.m.ComboBox") || ctrl.isA("sap.m.ComboBoxBase")) {
            ctrl.setValue(value);

            const item = ctrl.getItems().find(i => i.getText() === value || i.getKey() === value);
            if (item) {
              ctrl.setSelectedItem(item);
              ctrl.fireSelectionChange({ selectedItem: item });
            } else {
              ctrl.fireChange({ value });
              if (typeof ctrl.fireSubmit === "function") {
                ctrl.fireSubmit({ value });
              }
            }
            return;
          }

          if (ctrl.isA("sap.m.Input")) {
            ctrl.setValue(value);
            ctrl.fireChange({ value });

            const groups = ctrl.getFieldGroupIds?.() || [];
            if (groups.length > 0) {
              ctrl.fireValidateFieldGroup({ fieldGroupIds: groups });
            }
            if (typeof ctrl.fireSubmit === "function") {
              ctrl.fireSubmit({ value });
            }
            if (typeof ctrl.fireLiveChange === "function") {
              ctrl.fireLiveChange({ value });
            }
            return;
          }

          if (ctrl.setValue) {
            ctrl.setValue(value);
            ctrl.fireChange({ value });
          }
        }

                try {
                    setInputValueWithDetermination(target, newValue);
                    console.log(
                      \`%cStep: \${stepNumber} ✅ Set Value: \${target.getId()}\`,
                      "color: green; font-weight: bold;"
                    );
                    return true;
                } catch (e) {
                    console.error(
                      \`%cStep: \${stepNumber} ❌ Error setting value: \${e}\`,
                      "color: red; font-weight: bold;"
                    );
                    return false;
                }
            })();
            `,          
          ui5ClickButton: `(async function () {
          const buttonId = "{{BUTTON_ID}}";
          const stepNumber = "{{STEP_NUMBER}}";
          const maxWaitTime = {{TIMEOUT}}
          const interval = {{POLL}};

          function getButton() {
              return sap?.ui?.getCore?.().byId(buttonId);
          }

          async function waitForControl() {
              const start = Date.now();
              while (Date.now() - start < maxWaitTime) {
              const btn = getButton();
              if (btn) {
                  return btn;
              }
              await new Promise(r => setTimeout(r, interval));
              }
              return null;
          }

          try {
              const btn = await waitForControl();
              if (btn && typeof btn.firePress === "function") {
                btn.firePress();
                console.log(
                    \`%cStep: \${stepNumber} ✅ UI5 Create button clicked via firePress\`,
                    "color: green; font-weight: bold;"
                );
              } else if (btn) {
                console.error(
                    \`%cStep: \${stepNumber} ❌ Control found but firePress not supported: \${btn}\`,
                    "color: red; font-weight: bold;"
                );
              } else {
                console.error(
                    \`%cStep: \${stepNumber} ❌ Control not found after waiting 60 seconds\`,
                    "color: red; font-weight: bold;"
                );
              }
          } catch (err) {
              console.error(
                  \`%cStep: \${stepNumber} ❌ Error while waiting for control: \${err}\`,
                  "color: red; font-weight: bold;"
              );
          }
          })();`,      
        },
        noWait: {
          ui5Helper: `(function(){
            if (!window.sap || !sap.ui || !sap.ui.getCore) {
              console.error("❌ SAP UI5 not available on this page.");
              return;
            }
            // ============ ui5Helper =============
            window.ui5Helper = window.ui5Helper || {};
            (function(h){
              // --- Utility helpers ---
              h._allElements = () => Object.values(sap.ui.getCore().mElements || {});
              h.findViewById = (id)=> sap.ui.getCore().byId(id);
              h.findViewByName = (viewName) => {
                const els = h._allElements();
                for (const el of els){
                  try {
                    if (el.getViewName && el.getViewName() === viewName) return el;
                  } catch(e){}
                }
                return null;
              };
              h._matchBinding = (ctrl, propPath, pathPrefix) => {
                try{
                  const ctx = ctrl.getBindingContext && ctrl.getBindingContext();
                  if (!ctx) return false;
                  const path = ctx.getPath && ctx.getPath();
                  if (!path || !path.startsWith(pathPrefix)) return false;
                  const binding = (ctrl.getBindingInfo && (ctrl.getBindingInfo("value") || ctrl.getBindingInfo("text") || ctrl.getBindingInfo("selectedKey")));
                  if (!binding) return false;
                  const parts = binding.parts || [];
                  return parts.some(p => p.path === propPath);
                }catch(e){ return false; }
              };
              h._matchProperties = (ctrl, props) => {
                if (!props) return true;
                try {
                  return Object.entries(props).every(([k,v])=>{
                    const getter = "get" + k.charAt(0).toUpperCase()+k.slice(1);
                    if (typeof ctrl[getter] !== "function") return false;
                    return String(ctrl[getter]()) === String(v);
                  });
                } catch(e){ return false; }
              };
              h._hasDescendant = (root, sel) => {
                let found = null;
                root.findAggregatedObjects(true, c=>{
                  if (h._selectorMatch(c, sel)) { found = c; return true; }
                  return false;
                });
                return !!found;
              };
              h._selectorMatch = (ctrl, sel) => {
                if (sel.controlType && !(ctrl.isA && ctrl.isA(sel.controlType))) return false;
                if (sel.bindingPath && !h._matchBinding(ctrl, sel.bindingPath.propertyPath, sel.bindingPath.path)) return false;
                if (sel.properties && !h._matchProperties(ctrl, sel.properties)) return false;
                return true;
              };
              h._roots = (includeDialogs) => {
                const roots = [];
                const els = h._allElements();
                for (const el of els){
                  try{
                    if (el.getViewName && !el.getParent) roots.push(el);
                    if (includeDialogs && (el.isA && (el.isA("sap.m.Dialog") || el.isA("sap.m.Popover")))) roots.push(el);
                  }catch(e){}
                }
                return roots;
              };

              // --- Direct lookup (no polling/timeout) ---
              h.findBySelectorObject = function(selector){
                if (!selector) return null;
                // Direct byId
                if (selector.id){
                  return sap.ui.getCore().byId(selector.id);
                }
                // Find view by id or name (optional)
                let root = null;
                if (selector.viewId) root = sap.ui.getCore().byId(selector.viewId);
                if (!root && selector.viewName) root = h.findViewByName(selector.viewName);
                const searchRoots = [];
                if (root) searchRoots.push(root);
                // Optionally include dialogs/popovers
                for (const r of h._roots(!!selector.searchOpenDialogs)) {
                  if (!root || r === root) searchRoots.push(r);
                }
                // Deduplicate
                const uniq = Array.from(new Set(searchRoots));
                for (const R of uniq){
                  let candidate = null;
                  try {
                    R.findAggregatedObjects(true, c=>{
                      if (!h._selectorMatch(c, selector)) return false;
                      if (selector.descendant && !h._hasDescendant(c, selector.descendant)) return false;
                      candidate = c;
                      return true;
                    });
                  } catch(e){}
                  if (candidate) return candidate;
                }
                return null;
              };

              // --- Actions ---
              h.press = function(selOrId){
                let ctrl = null;
                if (typeof selOrId === "string") ctrl = sap.ui.getCore().byId(selOrId);
                else ctrl = h.findBySelectorObject(selOrId);
                if (!ctrl) { console.error("❌ press: control not found", selOrId); return false; }
                if (typeof ctrl.firePress === "function"){ ctrl.firePress(); return true; }
                if (typeof ctrl.fireSelect === "function"){ ctrl.fireSelect({}); return true; }
                if (typeof ctrl.fireTap === "function"){ ctrl.fireTap({}); return true; }
                console.warn("⚠ press: no press/select/tap on control; avoiding DOM click");
                return false;
              };

              h.setValue = function(opts){
                const { selector, value } = opts||{};
                let ctrl = null;
                if (!selector){ console.error("❌ setValue: missing selector"); return false; }
                if (selector.id){ ctrl = sap.ui.getCore().byId(selector.id); }
                if (!ctrl) ctrl = h.findBySelectorObject(selector);
                if (!ctrl || !ctrl.setValue){
                  console.error("❌ setValue: control not found or not an input", selector, ctrl);
                  return false;
                }
                try{
                  ctrl.setValue(value);
                  if (typeof ctrl.fireLiveChange === "function") ctrl.fireLiveChange({value});
                  if (typeof ctrl.fireChange === "function") ctrl.fireChange({value});
                  if (typeof ctrl.fireSubmit === "function") ctrl.fireSubmit({});
                  return true;
                }catch(e){
                  console.error("❌ setValue error:", e);
                  return false;
                }
              };
            })(window.ui5Helper);

            // ============ opa5Adapter (selector normalizer) ============
            window.opa5Adapter = window.opa5Adapter || {};
            (function(a,h){
              a.normalizeSelector = function(obj){
                return obj || {};
              };
            })(window.opa5Adapter, window.ui5Helper);

            console.log("%c✅ Helpers injected: ui5Helper + opa5Adapter Without Polling",  "color: green; font-weight: bold;");
          })();`,
          ui5SetValue: `return (async function () {
            if (!window.sap || !sap.ui || !sap.ui.getCore) {
                return console.error("%c❌ SAP UI5 not available", "color: red; font-weight: bold;");
            }

            const stepNumber = "{{STEP_NUMBER}}";
            const viewId = "{{VIEW_ID}}";
            const pathPrefix = "{{PATH_PREFIX}}";
            const propToSet = "{{PROPERTY_PATH}}";
            const newValue = "{{NEW_VALUE}}";

            let executionLocator = '';

            function findTarget() {
                let target = null;

                if (viewId && !propToSet && !pathPrefix) {
                    executionLocator = "STABLE LOCATOR: ";
                    target = sap.ui.getCore().byId(viewId);
                }

                if (!target && viewId && propToSet && pathPrefix) {
                    executionLocator = "UNSTABLE LOCATOR: ";
                    const oView = sap.ui.getCore().byId(viewId);
                    if (oView) {
                        const inputs = oView.findAggregatedObjects(true, ctrl => ctrl.isA("sap.m.Input"));
                        target = inputs.find(input => {
                            const ctx = input.getBindingContext();
                            if (!ctx) return false;
                            const path = ctx.getPath();
                            if (!path.startsWith(pathPrefix)) return false;
                            const bindInfo = input.getBindingInfo("value");
                            return bindInfo && bindInfo.parts.some(p => p.path === propToSet);
                        });
                    }
                }

                console.info("Step:", stepNumber, executionLocator, newValue, " TARGET: ", target);
                return target;
            }

            function setInputValueWithDetermination(ctrl, value) {
                if (!ctrl) return;

                if (ctrl.isA("sap.ui.comp.smartfield.SmartField")) {
                    const inner = ctrl.getFirstInnerControl?.()[0];
                    if (inner) {
                        return setInputValueWithDetermination(inner, value);
                    }
                }

                if (ctrl.isA("sap.m.ComboBox") || ctrl.isA("sap.m.ComboBoxBase")) {
                    ctrl.setValue(value);

                    const item = ctrl.getItems().find(i => i.getText() === value || i.getKey() === value);
                    if (item) {
                        ctrl.setSelectedItem(item);
                        ctrl.fireSelectionChange({ selectedItem: item });
                    } else {
                        ctrl.fireChange({ value });
                        if (typeof ctrl.fireSubmit === "function") {
                            ctrl.fireSubmit({ value });
                        }
                    }
                    return;
                }

                if (ctrl.isA("sap.m.Input")) {
                    ctrl.setValue(value);
                    ctrl.fireChange({ value });

                    const groups = ctrl.getFieldGroupIds?.() || [];
                    if (groups.length > 0) {
                        ctrl.fireValidateFieldGroup({ fieldGroupIds: groups });
                    }
                    if (typeof ctrl.fireSubmit === "function") {
                        ctrl.fireSubmit({ value });
                    }
                    if (typeof ctrl.fireLiveChange === "function") {
                        ctrl.fireLiveChange({ value });
                    }
                    return;
                }

                if (ctrl.setValue) {
                    ctrl.setValue(value);
                    ctrl.fireChange({ value });
                }
            }

            try {
                const target = findTarget();
                if (!target) {
                    console.error("Step:", stepNumber, "❌ Control not found");
                    console.error(
                      \`%cStep: \${stepNumber} ❌ Control not found: \${e}\`,
                      "color: red; font-weight: bold;"
                    );
                    return false;
                }

                setInputValueWithDetermination(target, newValue);
                console.log(
                  \`%cStep: \${stepNumber} ✅ Set Value: \${target.getId()}\`,
                  "color: green; font-weight: bold;"
                );
                return true;
            } catch (e) {
                console.error(
                  \`%cStep: \${stepNumber} ❌ Error setting value: \${e}\`,
                  "color: red; font-weight: bold;"
                );
                return false;
            }
        })();`,          
          ui5ClickButton: `(function () {
            const buttonId = "{{BUTTON_ID}}";
            const stepNumber = "{{STEP_NUMBER}}";

            try {
                const btn = sap?.ui?.getCore?.().byId(buttonId);

                if (btn && typeof btn.firePress === "function") {
                    btn.firePress();
                    console.log(
                        \`%cStep: \${stepNumber} ✅ UI5 Create button clicked via firePress\`,
                        "color: green; font-weight: bold;"
                    );
                } else if (btn) {
                    console.error(
                        \`%cStep: \${stepNumber} ❌ Control found but firePress not supported: \${btn}\`,
                        "color: red; font-weight: bold;"
                    );
                } else {
                  console.error(
                      \`%cStep: \${stepNumber} ❌ Control not found on the page\`,
                      "color: red; font-weight: bold;"
                  );
                }
            } catch (err) {
                console.error(
                    \`%cStep: \${stepNumber} ❌ Error while clicking the button: \${err}\`,
                    "color: red; font-weight: bold;"
                );
            }
        })();`,      
        },
      }
    };

    const RULES = {
          rules: {
            input: {
              keys: "last",
              fields: {
                actionType: "'input'",
                id: "recordReplaySelector.id",
                controlType: "recordReplaySelector.controlType",
                viewName: "recordReplaySelector.viewName",
                viewId: "recordReplaySelector.viewId",
                bindingPath: "recordReplaySelector.bindingPath.path",
                propertyPath: "recordReplaySelector.bindingPath.propertyPath",
                value: "recordReplaySelector.value",
                text: "recordReplaySelector.text"
              }
            },
            keypress: {
              keys: "last",
              fields: {
                actionType: "'input'",
                id: "recordReplaySelector.id",
                controlType: "recordReplaySelector.controlType",
                viewName: "recordReplaySelector.viewName",
                viewId: "recordReplaySelector.viewId",
                bindingPath: "recordReplaySelector.bindingPath.path",
                propertyPath: "recordReplaySelector.bindingPath.propertyPath",
                value: "recordReplaySelector.value",
                text: "recordReplaySelector.text"
              }
            },
            clicked: {
              when: "recordReplaySelector.value != null",
              fields: {
                actionType: "'input'",
                id: "recordReplaySelector.id",
                value: "recordReplaySelector.value",
                controlType: "recordReplaySelector.ancestor.controlType",
                viewName: "recordReplaySelector.ancestor.viewName",
                viewId: "recordReplaySelector.ancestor.viewId",
                bindingPath: "recordReplaySelector.ancestor.bindingPath",
                text: "recordReplaySelector.text"
              },
              elseFields: {
                actionType: "'click'",
                id: "recordReplaySelector.id",
                value: "recordReplaySelector.value",
                bindingPath: "recordReplaySelector.ancestor.bindingPath",
                text: "recordReplaySelector.text"
              }
            }
          }
      };

 
  function doTransformation(OPA5Text, input) {
    
    const rules = {
        rules: {
          input: {
            keys: "last",
            fields: {
              actionType: "'input'",
              id: "recordReplaySelector.id",
              controlType: "recordReplaySelector.controlType",
              viewName: "recordReplaySelector.viewName",
              viewId: "recordReplaySelector.viewId",
              bindingPath: "recordReplaySelector.bindingPath.path",
              propertyPath: "recordReplaySelector.bindingPath.propertyPath",
              value: "recordReplaySelector.value",
              text: "recordReplaySelector.text"
            }
          },
          keypress: {
            keys: "last",
            fields: {
              actionType: "'input'",
              id: "recordReplaySelector.id",
              controlType: "recordReplaySelector.controlType",
              viewName: "recordReplaySelector.viewName",
              viewId: "recordReplaySelector.viewId",
              bindingPath: "recordReplaySelector.bindingPath.path",
              propertyPath: "recordReplaySelector.bindingPath.propertyPath",
              value: "recordReplaySelector.value",
              text: "recordReplaySelector.text"
            }
          },
          clicked: {
            when: "recordReplaySelector.value != null",
            fields: {
              actionType: "'input'",
              id: "recordReplaySelector.id",
              value: "recordReplaySelector.value",
              controlType: "recordReplaySelector.ancestor.controlType",
              viewName: "recordReplaySelector.ancestor.viewName",
              viewId: "recordReplaySelector.ancestor.viewId",
              bindingPath: "recordReplaySelector.ancestor.bindingPath",
              text: "recordReplaySelector.text"
            },
            elseFields: {
              actionType: "'click'",
              id: "recordReplaySelector.id",
              value: "recordReplaySelector.value",
              bindingPath: "recordReplaySelector.ancestor.bindingPath",
              text: "recordReplaySelector.text"
            }
          }
        }
    };


    const result = [];
    if (!OPA5Text.steps || !Array.isArray(OPA5Text.steps)) {
      const errMsg = 'No steps found in input JSON';
      log.err(errMsg);
      throw new Error(errMsg);
    }

    // First Loop - Transform OPA5 steps to intermediate format
    OPA5Text.steps.forEach(step => {
      const rule = rules.rules[step.actionType];

      let obj = step;
      if (step.keys && rule.keys === "last") {
        obj = step.keys[step.keys.length - 1];
      }

      // choose fields or elseFields based on "when"
      let fieldsToUse = rule.fields;
      if (rule.when) {
        const [path, operator, rawValue] = rule.when.split(" ");
        const actualValue = getValueByPath(step, path);
        const expectedValue = rawValue === "null" ? null : rawValue.replace(/'/g, "");

        let conditionMet = false;
        if (operator === "!=") conditionMet = actualValue != expectedValue;
        if (operator === "==") conditionMet = actualValue == expectedValue;

        if (!conditionMet && rule.elseFields) {
          fieldsToUse = rule.elseFields;
        }
      }

      const transformed = {};
      for (let [key, path] of Object.entries(fieldsToUse)) {
        if (path.startsWith("'") && path.endsWith("'")) {
          transformed[key] = path.slice(1, -1); // literal value
        } else {
          transformed[key] = getValueByPath(obj, path);
        }
      }
      result.push(transformed);
    });

    console.log(`Intermediate transformation result:`, result);
    

    // Second Loop
    let stepNum = 1;
    const steps = [];  

      // Create Initial Steps
      for (const stepDef of converterConfig.initialSteps) {
          const processedData = initialProcessStep(stepDef, input);
          if (processedData !== null) {
              steps.push(makeStep(stepNum, stepDef.desc, processedData, stepDef.locator, stepDef.user_action));
              log.ok(`Step ${stepNum}: ${stepDef.desc} added`);
              stepNum++;
          } else {
              log.warn(`Step skipped: ${stepDef.desc}`);
          }
      }

    // UI5 Helper Inject
    if (converterConfig.global.insertUi5HelperAtStart && input.injectHelpers) {
        const templateSetHelper = input.waitEach ? converterConfig.templates.wait : converterConfig.templates.noWait;
        const scriptContent = templateSetHelper.ui5Helper;

        let Jscript = scriptContent;          
        if (input.waitEach) {
            Jscript = Jscript
                .replace(/{{POLL}}/g, input.poll || 0)
                .replace(/{{TIMEOUT}}/g, input.timeout || 0);
        }

        steps.push(makeStep(stepNum, "Inject UI5 + OPA5 helpers", Jscript));
        log.ok(`Step ${stepNum}: Added ${input.waitEach ? 'polling' : 'non-polling'} helper injection`);
        stepNum++;
    }

      try {
          result.map(data => {
              const viewId = data?.viewId ? data.viewId : (data?.id || '');
              const pathPrefix = typeof data?.bindingPath === "string"
                  ? data.bindingPath.replace(/,DraftUUID.*\)/, "")
                  : (data?.bindingPath?.path
                      ? data.bindingPath.path.replace(/,DraftUUID.*\)/, "")
                      : "");

              const propertyPath = typeof data?.bindingPath === "object"
                  ? data.bindingPath?.propertyPath || ""
                  : data?.propertyPath || "";

              const newValue = data?.value || '';   
              
              const actionConfig = converterConfig.actions[data.actionType];
              if (!actionConfig) {
                  log.warn(`No action config found for type: ${data.actionType}`);
                  return;
              }

              // Select template set based on waitEach flag
              const templateSet = input.waitEach ? converterConfig.templates.wait : converterConfig.templates.noWait;
              const templateName = actionConfig.templateName;
              
              if (!templateName || !templateSet[templateName]) {
                  log.warn(`Template not found: ${templateName} in ${input.waitEach ? 'wait' : 'noWait'} set`);
                  return;
              }

              // Get template and perform replacements
              let Jscript = templateSet[templateName]
                  .replace(/{{STEP_NUMBER}}/g, stepNum.toString())
                  .replace(/{{VIEW_ID}}/g, viewId || "")
                  .replace(/{{PATH_PREFIX}}/g, pathPrefix || "")
                  .replace(/{{PROPERTY_PATH}}/g, propertyPath || "")
                  .replace(/{{BUTTON_ID}}/g, viewId || "")
                  .replace(/{{NEW_VALUE}}/g, newValue || "");
              
              // Add polling parameters only for wait templates
              if (input.waitEach) {
                  Jscript = Jscript
                      .replace(/{{POLL}}/g, input.poll || 0)
                      .replace(/{{TIMEOUT}}/g, input.timeout || 0);
              }
              
              const stepData = data.actionType+" "+newValue+" in "+(data.text ? data.text : viewId);
              steps.push(makeStep(
                      stepNum,
                      stepData,
                      Jscript
                  ));

              log.ok(`Step ${stepNum}: Generated for Action="${data.actionType}", ViewId="${viewId}", Property="${propertyPath}", Value="${newValue}"`);
              stepNum++;
          });

          log.ok(`Transformation complete. Total steps: ${steps.length}`);
          return renderOutput(steps);
      }
      catch(e){
          log.err("Error during transformation: " + e.message);
          throw e;
      }
  }


  function makeStep(stepNumber, description, data, locator = "", userAction = "Execute Javascript") {
    return {
      Step_Number: stepNumber,
      Step_Description: description,
      Control_Type: "WebElement",
      Locator_Type: "Id",
      Locator_Value: locator ? locator : "",
      User_Action: userAction,
      Data_Column: stepNumber,
      Step_Property: "text",
      Step_Index: "",
      Step_Data: data,
      Screenshot_Enabled: true,
      Optional_Step_Enabled: false,
      Parameterized_Step_Enabled: false,
      Shadow_Step_Enabled: false,
      Is_Iterate_Step: false,
      Parent_Step_Number: stepNumber-1,
      Data_View_Type: "text",
    };
  }


  function buildRequestPayload(input) {
    
    const payload = {
      injectHelpers: input.injectHelpers ?? true,
      waitEach: input.waitEach ?? true,
      timeout: input.timeout ?? 30000,
      poll: input.poll ?? 200,
      launchEnabled: input.launch ?? true,
      launchUrl: input.launchUrl ?? '',
      waitAfterLaunchEnabled: (input.launch ?? true) && !!input.waitAfterLaunch,
      waitAfterLaunch: input.waitAfterLaunch ? 30 : null,
      loginEnabled: input.login ?? true,
      loginUser: input.loginUser ?? '',
      loginPass: input.loginPass ?? '',
      waitAfterLoginEnabled: (input.login ?? true) && !!input.waitAfterLogin,
      waitAfterLogin: (input.login ?? true) && input.waitAfterLogin ? 60 : null,
      opa5Input: input.opa5Text ?? {}
    };

    return payload;
  }

  function initialProcessStep(stepDef, input) { // Add Step data only if checkbox enabled
      let jsData = stepDef.data || "";
      let shouldAdd = true;

      const rules = [
          { token: "{launchUrl}", enabled: input.launchEnabled, value: input.launchUrl },
          { token: "{loginUser}", enabled: input.loginEnabled, value: input.loginUser },
          { token: "{loginPass}", enabled: input.loginEnabled, value: input.loginPass },
          { token: "{loginLink}", enabled: input.loginEnabled, value: '' },
          { token: "{waitAfterLaunchTime}", enabled: input.waitAfterLaunchEnabled, value: input.waitAfterLaunch },
          { token: "{waitAfterLoginTime}", enabled: input.waitAfterLoginEnabled, value: input.waitAfterLogin }
      ];

      for (const { token, enabled, value } of rules) {
          if (jsData.includes(token)) {
              if (enabled) {
                  jsData = jsData.replace(token, value);
              } else {
                  shouldAdd = false;
              }
          }
      }

      return shouldAdd ? jsData : null;
  }

  function getValueByPath(obj, path) {
    if (!path) return null;
    return path.split(".").reduce((acc, part) => acc?.[part], obj);
  }

  function getTransformedOPA5Data(OPA5Text) { 

    const result = [];
    if (!OPA5Text.steps || !Array.isArray(OPA5Text.steps)) {
      const errMsg = 'No steps found in input JSON';
      log.err(errMsg);
      throw new Error(errMsg);
    }

    // First Loop - Transform OPA5 steps to intermediate format
    OPA5Text.steps.forEach(step => {
      const rule = RULES.rules[step.actionType];

      let obj = step;
      if (step.keys && rule.keys === "last") {
        obj = step.keys[step.keys.length - 1];
      }

      // choose fields or elseFields based on "when"
      let fieldsToUse = rule.fields;
      if (rule.when) {
        const [path, operator, rawValue] = rule.when.split(" ");
        const actualValue = getValueByPath(step, path);
        const expectedValue = rawValue === "null" ? null : rawValue.replace(/'/g, "");

        let conditionMet = false;
        if (operator === "!=") conditionMet = actualValue != expectedValue;
        if (operator === "==") conditionMet = actualValue == expectedValue;

        if (!conditionMet && rule.elseFields) {
          fieldsToUse = rule.elseFields;
        }
      }

      const transformed = {};
      for (let [key, path] of Object.entries(fieldsToUse)) {
        if (path.startsWith("'") && path.endsWith("'")) {
          transformed[key] = path.slice(1, -1); // literal value
        } else {
          transformed[key] = getValueByPath(obj, path);
        }
      }
      result.push(transformed);
    });

    return result;
  }

  return {
      convertToTestSteps,
      getTransformedOPA5Data
  };

});


