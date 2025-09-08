sap.ui.define([], function () { // ensures compatibility with UI5 system.

  let collectedLogs = [];
  let transformationDisplayData = [];
  let qyrusScriptArray = []; 

  function convertToTestSteps(receiveInput) {
      collectedLogs = [];
      transformationDisplayData = [];
      qyrusScriptArray = [];
      console.log("Input:", receiveInput);
      const input = buildRequestPayload(receiveInput);
      const output = doTransformation(input.opa5Input, input);

      console.log('Output: ', output);
      return output;
  }

  function renderOutput(finalSteps) {    
      const output = {
          logs: collectedLogs,
          transformationDisplayData: transformationDisplayData,
          steps: {testSteps: finalSteps}
      };
      return output;
  }

  const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
  };

  const log = {
      info: (m) => { collectedLogs.push({ level: "info", msg: m }); },
      ok:   (m) => { collectedLogs.push({ level: "ok", msg: "✔ " + m }); },
      warn: (m) => { collectedLogs.push({ level: "warn", msg: "⚠ " + m }); },
      err:  (m) => { collectedLogs.push({ level: "err", msg: "✖ " + m }); }
  };

  const fieldConfig = {
      "myId": {
        "priority": ["viewId", "id"]
      },
      "myPath": {
        "priority": ["bindingPath", "bindingPath.path"]
      },
      "myPropertyPath": {
        "priority": ["propertyPath", "bindingPath.propertyPath"]
      },
      "pathPrefix": {
        "toReplace": ["DraftUUID"]
      }
    };
  
  const converterConfig = {
      global: {
        insertUi5HelperAtStart: true,
        injectUi5HelperDesc: "Inject UI5 + OPA5 helpers",
        ui5HelperUserAction: "Execute Javascript",
      },
      initialSteps: [
        { user_action: "Go to url", desc: "Launch Application", locator: "", dataKey: "launchUrl", enabledKeys: ["launchEnabled"] },
        { user_action: "Wait", desc: "Wait for Element", locator: "USERNAME_FIELD-inner", dataKey: "waitAfterLaunch", enabledKeys: ["launchEnabled", "waitAfterLaunchEnabled"] },
        { user_action: "Set", desc: "Set Username", locator: "USERNAME_FIELD-inner", dataKey: "loginUser", enabledKeys: ["loginEnabled"] },
        { user_action: "Set", desc: "Set Password", locator: "PASSWORD_FIELD-inner", dataKey: "loginPass", enabledKeys: ["loginEnabled"] },
        { user_action: "Click", desc: "Click Log On", locator: "LOGIN_LINK", enabledKeys: ["loginEnabled"] },
        { user_action: "Wait", desc: "Wait After Login", locator: "", dataKey: "waitAfterLogin", enabledKeys: ["loginEnabled", "waitAfterLoginEnabled"] }
      ],
      actions: {
        clicked: {
          userAction: "Execute Javascript",
          locatorType: "Id",
          stepProperty: "text",
          templateName: "ui5ClickButton"
        },
        input: {
          userAction: "Execute Javascript",
          locatorType: "Id",
          stepProperty: "text",
          templateName: "ui5SetValue"
        },
        wait: {
          userAction: "Execute Javascript",
          locatorType: "Id",
          stepProperty: "text"
        }
      },
      templates: {
        ui5Helper_old: `(function(){
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

            console.log("✅ Helpers injected: ui5Helper + opa5Adapter");
          })();`,
        ui5Helper: `(() => {
          window.ui5Helper = {
            setValue: function(config) {
              try {
                let control = sap.ui.getCore().byId(config.selector.id);

                if (control && typeof control.setValue === "function") {
                  control.setValue(config.value);

                  if (typeof control.fireChange === "function") {
                    control.fireChange({ value: config.value });
                  }

                  console.log('✅ UI5 setValue executed: ' + config.value);
                  return true;
                } else {
                  const element = document.getElementById(config.selector.id);
                  if (element) {
                    element.focus();
                    element.value = config.value;
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    element.dispatchEvent(new Event('change', { bubbles: true }));
                    element.blur();
                    console.log('✅ DOM setValue executed: ' + config.value);
                    return true;
                  }
                }

                // ❌ Fail case
                throw new Error(\`Control or element not found for id: \${config.selector.id}\`);

              } catch (error) {
                console.error('❌ Error in setValue:', error);
                throw error;
              }
            }
          };
          console.log('✅ ui5Helper injected');
        })();
        `,
        wait: {
          ui5SetValue: `return (async function() {
            const stepNumber = "{{STEP_NUMBER}}";
            const viewId = "{{VIEW_ID}}";
            const pathPrefix = "{{PATH_PREFIX}}";
            const propToSet = "{{PROPERTY_PATH}}";
            const enteredValue = "{{NEW_VALUE}}";
            
            const timeoutMs = {{TIMEOUT}};
            const pollInterval = {{POLL}};

            function findTarget() {
              let target = null;

              if (propToSet) { // Unstable locator
                  const inputs = Object.values(sap.ui.core.Element.registry.all())
                              .filter(ctrl => ctrl.isA("sap.m.Input"));
                  target = inputs.find(input => {
                      const ctx = input.getBindingContext();
                      if (!ctx) return false;

                      const path = ctx.getPath();
                      if (!path.startsWith(pathPrefix)) return false;

                      const bindInfo = input.getBindingInfo("value");
                      return bindInfo && bindInfo.parts.some(p => p.path === propToSet);
                  });
              } else { // Stable locator available
                  target = sap.ui.getCore().byId(viewId);
              }
              return target;
            }

            // Wait loop (dynamic wait)
            async function waitForTarget() {
              const start = Date.now();
              return new Promise((resolve, reject) => {
                (function check() {
                  const target = findTarget();
                  if (target) return resolve(target);

                  if (Date.now() - start > timeoutMs) {
                    return reject(new Error(\`⏰ Timeout: Could not find input\`));
                  }
                  setTimeout(check, pollInterval);
                })();
              });
            }

            function setInputValueWithDetermination(ctrl, value) {
                  if (!ctrl) return;
                  
                  if (typeof ctrl.setValue === "function") {
                      ctrl.setValue(value);

                      // Always fire change (basic binding update)
                      ctrl.fireChange({ value });

                      // Fire field group validation (like leaving field / pressing Enter)
                      const groups = ctrl.getFieldGroupIds?.() || [];
                      if (groups.length > 0) {
                          ctrl.fireValidateFieldGroup({ fieldGroupIds: groups });
                      }

                      // If the control supports submit (like search fields)
                      if (typeof ctrl.fireSubmit === "function") {
                          ctrl.fireSubmit({ value });
                      }

                      // Extra: fire liveChange (some apps hook into this)
                      if (typeof ctrl.fireLiveChange === "function") {
                          ctrl.fireLiveChange({ value });
                      }

                      // setProperty for directly changing the underlying data/model
                      if (propToSet) {
                          const ctxPath = ctrl.getBindingContext().getPath();
                          if(ctxPath) {
                              const basePath = ctxPath.split(")")[0] + ")";
                              const fullPath = \`\${basePath}/\${propToSet}\`;

                              const oModel = ctrl.getModel();
                              oModel.setProperty(fullPath, value);
                          }
                      }
                      return true;
                  }        
                  return false;
              }

            try {
              const target = await waitForTarget();
              console.log("✅ Found target control:", target);
              const isSetValue = setInputValueWithDetermination(target, enteredValue);
              if (!isSetValue) { 
                  console.error("Control does not support setValue");
                  throw new Error("Control does not support setValue");
              }

              console.log(\`✅ Set \${propToSet} = "\${enteredValue}" on control\`, target);
              return true;    
            } catch (err) {
              console.error("❌ Failed to set value:", err.message);
              throw err;
            }
          })();
          `,
          ui5ClickButton: `(async function () {
            const buttonId = "{{BUTTON_ID}}";
            const pathPrefix = "{{PATH_PREFIX}}";
            const propToSet = "{{PROPERTY_PATH}}";
            const stepNumber = "{{STEP_NUMBER}}";
            const maxWaitTime = {{ TIMEOUT }};
            const interval = {{ POLL }};

            function getButtonTarget() {
                let target = null;

                if (propToSet) { // Dynamic locator via input binding (if button is near input)
                    const inputs = Object.values(sap.ui.core.Element.registry.all())
                        .filter(ctrl => ctrl.isA("sap.m.Input"));

                    const input = inputs.find(input => {
                        const ctx = input.getBindingContext();
                        if (!ctx) return false;

                        const path = ctx.getPath();
                        if (!path.startsWith(pathPrefix)) return false;

                        const bindInfo = input.getBindingInfo("value");
                        return bindInfo && bindInfo.parts.some(p => p.path === propToSet);
                    });

                    if (input) {
                        // Assuming button is sibling of input
                        const parent = input.getParent();
                        target = parent?.getContent?.()?.find(c => c.isA && c.isA("sap.m.Button"));
                    }
                } else {
                  target = sap?.ui?.getCore?.().byId(buttonId);  
                }

                return target;
            }

            async function waitForControl() {
                const start = Date.now();
                return new Promise((resolve, reject) => {
                    (function check() {
                        const target = getButtonTarget();
                        if (target) return resolve(target);

                        if (Date.now() - start > maxWaitTime) {
                            return reject(new Error(\`⏰ Timeout: Could not find input\`));
                              }
                              setTimeout(check, interval);
                            })();
                          });
            }

            try {
                const btn = await waitForControl();
                if (btn && typeof btn.firePress === "function") {
                    btn.firePress();
                    console.log(
                        \`Step: \${stepNumber} ✅ UI5 Create button clicked via firePress\`
                            );
                          } else if (btn) {
                            console.error(
                                \`Step: \${stepNumber} ❌ Control found but firePress not supported: \${btn}\`
                            );
                            throw new Error("Control does not support firePress");
                          } else {
                            console.error(
                                \`Step: \${stepNumber} ❌ Control not found after waiting 60 seconds\`
                            );
                            throw new Error("Control not found");
                          }
                      } catch (err) {
                          console.error(
                              \`Step: \${stepNumber} ❌ Error while waiting for control: \${err}\`
                          );
                          throw err;
                      }
                      })();
          `,
          ui5SetValue_old: `return (async function () {
                if (!window.sap || !sap.ui || !sap.ui.getCore) {
                    console.error("❌ SAP UI5 not available");
                    throw new Error("SAP UI5 not available");
                }

                const stepNumber = "{{STEP_NUMBER}}";
                const viewId = "{{VIEW_ID}}";
                const pathPrefix = "{{PATH_PREFIX}}";
                const propToSet = "{{PROPERTY_PATH}}";
                const newValue = "{{NEW_VALUE}}";

                /***************************************/                
                const timeoutMs = {{TIMEOUT}};
                const intervalMs = {{POLL}};
                const start = Date.now();
                /***************************************/

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
                          \`Step: \${stepNumber} ⏰ Timeout: Control not found\`
                        );
                        throw new Error("Timeout waiting for control");
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
                      \`Step: \${stepNumber} ✅ Set Value: \${target.getId()}\`
                    );
                    return true;
                } catch (e) {
                    console.error(
                      \`Step: \${stepNumber} ❌ Error setting value: \${e}\`
                    );
                    throw e;
                }
            })();
            `,          
          ui5ClickButton_old: `(async function () {
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
                    \`Step: \${stepNumber} ✅ UI5 Create button clicked via firePress\`
                );
              } else if (btn) {
                console.error(
                    \`Step: \${stepNumber} ❌ Control found but firePress not supported: \${btn}\`
                );
                throw new Error("Control does not support firePress");
              } else {
                console.error(
                    \`Step: \${stepNumber} ❌ Control not found after waiting 60 seconds\`
                );
                throw new Error("Control not found");
              }
          } catch (err) {
              console.error(
                  \`Step: \${stepNumber} ❌ Error while waiting for control: \${err}\`
              );
              throw err;
          }
          })();`,      
        },
        noWait: {          
          ui5SetValue: `return (async function () {
            if (!window.sap || !sap.ui || !sap.ui.getCore) {
                console.error("❌ SAP UI5 not available");
                throw new Error("SAP UI5 not available");
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
                      \`Step: \${stepNumber} ❌ Control not found: \${e}\`
                    );
                    throw new Error("Control not found");
                }

                setInputValueWithDetermination(target, newValue);
                console.log(
                  \`Step: \${stepNumber} ✅ Set Value: \${target.getId()}\`
                );
                return true;
            } catch (e) {
                console.error(
                  \`Step: \${stepNumber} ❌ Error setting value: \${e}\`
                );
                throw e;
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
                        \`Step: \${stepNumber} ✅ UI5 Create button clicked via firePress\`
                    );
                } else if (btn) {
                    console.error(
                        \`Step: \${stepNumber} ❌ Control found but firePress not supported: \${btn}\`
                    );
                    throw new Error("Control does not support firePress");
                } else {
                  console.error(
                      \`Step: \${stepNumber} ❌ Control not found on the page\`
                  );
                  throw new Error("Control not found on the page");
                }
            } catch (err) {
                console.error(
                    \`Step: \${stepNumber} ❌ Error while clicking the button: \${err}\`
                );
                throw err;
            }
        })();`,      
        },
      }
    };

    

    
  function doTransformation(OPA5Text, input) {
    
    const rules = {
        rules: {
          input: {
            keys: "last", // We will have keys array for input events
            fields: {
              actionType: "input",
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
            fields: {
              actionType: "input",
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
          validate: {
            fields: {
              actionType: "clicked",
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
            when: "step.recordReplaySelector.value != null",
            fields: {
              actionType: "input",
              id: "recordReplaySelector.id",
              value: "recordReplaySelector.value",
              controlType: "recordReplaySelector.ancestor.controlType",
              viewName: "recordReplaySelector.ancestor.viewName",
              viewId: "recordReplaySelector.ancestor.viewId",
              bindingPath: "recordReplaySelector.ancestor.bindingPath",
              text: "recordReplaySelector.text"
            },
            elseFields: {
              actionType: "clicked",
              id: "recordReplaySelector.id",
              value: "recordReplaySelector.value",
              bindingPath: "recordReplaySelector.ancestor.bindingPath",
              text: "recordReplaySelector.text"
            }
          }
        }
    };

    
    const simpleTestStepArray = [];
    if (!OPA5Text.steps || !Array.isArray(OPA5Text.steps)) {
      const errMsg = 'No steps found in input JSON';
      log.err(errMsg);
      throw new Error(errMsg);
    }

    // First Loop - Transform OPA5 steps to intermediate format
    OPA5Text.steps.forEach(step => {
      const rule = rules.rules[step.actionType];

      if(!rule) {
        log.error(`No rule defined for actionType: ${step.actionType}. Step skipped.`);
        throw new Error(`No rule defined for actionType: ${step.actionType}`);
      }
      // `step.keys` will be available only for actionType `input`.      
      // If a keys array is available it means all values for further process should be taken from under the keys array.
      // Most cases relavant updated values (id, controlId, PropertyPath, enteredValue) are available in in the last keys array.
      // Hence in config we have mentioned keys.last
      // With this config all values under the last keys are used for further processing
      let obj = step;
      if (step.keys) {
        if(rule.keys === "last") {
          obj = step.keys[step.keys.length - 1];
        }
      }

      let fieldsToUse = rule.fields;
      if (step.actionType === "clicked") {
        if (step.recordReplaySelector?.value != null) {
          fieldsToUse = rule.fields;   // value help
        } else {
          fieldsToUse = rule.elseFields; // button click
        }
      }

      // let fieldsToUse;
      // if (rule.when) {
      //   if (eval(rule.when)) {
      //     fieldsToUse = rule.fields;
      //   } else {
      //     fieldsToUse = rule.elseFields;
      //   }
      // } else {
      //   fieldsToUse = rule.fields;
      // }
  
      const transformed = {};
      for (let [key, path] of Object.entries(fieldsToUse)) {
        transformed[key] = getValueByPath(obj, path);
      }
      simpleTestStepArray.push(transformed);
    });
    transformationDisplayData.push(...simpleTestStepArray);
 
    // Second Loop
    let stepNum = 1;     

    // Insert Initial Steps like Launch, Login, and UI5 Helper
    stepNum = initialSteps(stepNum, input);   

      try {
        console.log('simpleTestStepArray: ', simpleTestStepArray)
          simpleTestStepArray.map(data => {

              // Extracting ID, Path, and Property Path
              const myId = fieldConfig.myId.priority
                .map(p => p.split('.').reduce((acc, key) => acc?.[key], data))
                .find(v => v !== undefined);

              const myPath = fieldConfig.myPath.priority
                .map(p => p.split('.').reduce((acc, key) => acc?.[key], data))
                .find(v => v !== undefined)?.replace(
                  new RegExp(`,(?:${fieldConfig.pathPrefix.toReplace.join("|")}).*\\)`),
                  ""
                );

              const myPropertyPath = fieldConfig.myPropertyPath.priority
                .map(p => p.split('.').reduce((acc, key) => acc?.[key], data))
                .find(v => v !== undefined);

              console.log(`Step ${stepNum}, actionType: ${data.actionType}, myId: ${myId}, myPath: ${myPath}, myPropertyPath: ${myPropertyPath}`);
              const enteredValue = data?.value || '';

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

              // Get template and update placeholders
              let Jscript = templateSet[templateName]
                  .replace(/{{STEP_NUMBER}}/g, stepNum.toString())
                  .replace(/{{VIEW_ID}}/g, myId || "")
                  .replace(/{{PATH_PREFIX}}/g, myPath || "")
                  .replace(/{{PROPERTY_PATH}}/g, myPropertyPath || "")
                  .replace(/{{BUTTON_ID}}/g, myId || "")
                  .replace(/{{NEW_VALUE}}/g, enteredValue || "")
                  .replace(/{{POLL}}/g, input.poll)
                  .replace(/{{TIMEOUT}}/g, input.timeout);
              
              // Add polling parameters only for wait templates
              // if (input.waitEach) {
              //     Jscript = Jscript
              //         .replace(/{{POLL}}/g, input.poll)
              //         .replace(/{{TIMEOUT}}/g, input.timeout);
              // }

              const stepData = data.actionType+" "+enteredValue+" in "+(data.text ? data.text : myId);
              // Add test step to the list
              qyrusScriptArray.push(makeStep(
                      stepNum,
                      stepData,
                      Jscript,
                      "",
                      converterConfig.actions[data.actionType].userAction
                  ));

              log.ok(`Step ${stepNum}: Generated for Action="${data.actionType}", ViewId="${myId}", Property="${myPropertyPath}", Value="${enteredValue}"`);
              stepNum++;
          });

          log.ok(`Transformation complete. Total steps: ${qyrusScriptArray.length}`);
          return renderOutput(qyrusScriptArray);
      }
      catch(e){
          log.err("Error during transformation: " + e.message);
          throw e;
      }
  }


  function initialSteps(stepNum, input) {
    
    for (const stepDef of converterConfig.initialSteps) {
        const isEnabled = stepDef.enabledKeys.every(key => input[key] ?? true); // Check if all enabledKeys based on UI input are true
        if(isEnabled) {
          const stepInputData = stepDef.dataKey ? input[stepDef.dataKey] : ""; // get step data from UI
          // Add Initial steps
          qyrusScriptArray.push(makeStep(
            stepNum, 
            stepDef.desc, 
            stepInputData, 
            stepDef.locator, 
            stepDef.user_action
          ));
          log.ok(`${colors.green}✅ Step ${stepNum}: ${stepDef.desc} added`);
          // log.error(`${colors.red}❌ Step skipped: ${stepDef.desc}${colors.reset}`);          
        } else {
          log.warn(`${colors.yellow}⚠️ Step skipped: ${stepDef.desc}`);
        }
        stepNum++;        
    }

    if (converterConfig.global.insertUi5HelperAtStart) {
        const Jscript = converterConfig.templates.ui5Helper;
        qyrusScriptArray.push(makeStep(
            stepNum, 
            converterConfig.global.injectUi5HelperDesc, 
            Jscript, 
            "", 
            converterConfig.global.ui5HelperUserAction
          )
        );
        log.ok(`Step ${stepNum}: Added helper injection`);
        stepNum++;
    } else {
      log.warn(`UI5 Helper injection skipped`);
    }

    return stepNum;
  }


  function makeStep(stepNumber, description, data, locator = "", userAction) {
    return {
      Step_Number: stepNumber,
      Step_Description: description,
      Control_Type: "WebElement",
      Locator_Type: "Id",
      Locator_Value: locator,
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

  
  function getValueByPath(obj, path) {
    if (!path) return null;
    if (!path.includes(".")) {
      return path;
    }
    return path.split(".").reduce((acc, part) => acc?.[part], obj);
  }

  
  return {
      convertToTestSteps
  };

});


