(() => {
  class e {
    #e;
    #t;
    #r;
    #n;
    #captureValueHelp;
    #captureSelection;
    constructor() {
      try {
        this.#t = sap.ui.requireSync("sap/ui/test/RecordReplay");
      } catch (e) {
        this.#t = null;
      }
      try {
        this.#r = sap.ui.requireSync("sap/m/MessageToast");
      } catch (e) {
        this.#r = null;
      }
      this.#n = true;
    }

    getDataOnLoad() {
      const attachValueHelpHook = (ctrl) => {
        if (ctrl instanceof sap.m.Input && !ctrl._vhHooked) {
          ctrl._vhHooked = true;
          if (typeof ctrl.attachValueHelpRequest === "function") {
            ctrl.attachValueHelpRequest(() => {
              console.log("✅ ValueHelp on:", ctrl.getId());
              this.#captureValueHelp = ctrl;
            });
          }
        }
      };

      const attachValueHelpHooks = () => {
        const elems = sap.ui.core.Element.registry.all
          ? sap.ui.core.Element.registry.all()
          : sap.ui.core.Element.registry.mElements;

        Object.values(elems).forEach(attachValueHelpHook);
      };

      // 1️⃣ Run once after Core initialized
      if (sap.ui.getCore().isInitialized()) {
        attachValueHelpHooks();
      } else {
        sap.ui.getCore().attachInit(attachValueHelpHooks);
      }

      // 2️⃣ Re-run after each rendering
      sap.ui.getCore().attachEvent("UIUpdated", attachValueHelpHooks);

      // 3️⃣ Smart polling fallback (self-stopping)
      let lastCount = 0;
      let idleCycles = 0;
      let pollingActive = false;

      const smartRecheck = () => {
        const elems = sap.ui.core.Element.registry.all
          ? sap.ui.core.Element.registry.all()
          : sap.ui.core.Element.registry.mElements;
        const count = Object.keys(elems).length;

        if (count > lastCount) {
          lastCount = count;
          idleCycles = 0;
          attachValueHelpHooks();
        } else {
          idleCycles++;
        }

        if (idleCycles < 10 && pollingActive) {
          setTimeout(smartRecheck, 2000);
        } else if (pollingActive) {
          console.log("Stopped ValueHelp watcher (idle).");
          pollingActive = false;
        }
      };

      const startSmartPolling = () => {
        if (!pollingActive) {
          pollingActive = true;
          idleCycles = 0;
          setTimeout(smartRecheck, 2000);
        }
      };

      // restart polling on every UI update
      sap.ui.getCore().attachEvent("UIUpdated", startSmartPolling);

      // initial kick
      startSmartPolling();

      // 4️⃣ DOM-level MutationObserver for instant detection
      const observer = new MutationObserver((mutations) => {
        // Run only if new nodes inserted (not attribute changes)
        const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
        if (hasNewNodes) attachValueHelpHooks();
      });

      observer.observe(document.body, { childList: true, subtree: true });

      console.log("🚀 ValueHelp hook system initialized.");
    }




    //our code

    enableRecording() {
      this.#s = this.#s.name.startsWith("bound ")
        ? this.#s
        : this.#s.bind(this);
      this.#i = this.#i.name.startsWith("bound ")
        ? this.#i
        : this.#i.bind(this);
      this.#o = this.#o.name.startsWith("bound ")
        ? this.#o
        : this.#o.bind(this);
      document.addEventListener("mouseover", this.#s);
      document.addEventListener("mouseout", this.#i);
      document.addEventListener("click", this.#o);
      document.addEventListener("keydown", this.#k);
      // our code
      this.getDataOnLoad();
      // our code
    }
    disableRecording() {
      if (this.#e && this.#e.removeStyleClass) {
        this.#e.removeStyleClass("injectClass");
      }
      this.#e = null;
      document.removeEventListener("mouseover", this.#s);
      document.removeEventListener("mouseout", this.#i);
      document.removeEventListener("click", this.#o);
    }
    getElementsForId(e) {
      return Object.values(this.#l()).filter((t) => t.getId() === e);
    }

    getElementsBySelectors(e) {
      let r = this.#l();
      r = Object.values(r).filter(
        (t) => t.getMetadata().getElementName() === e.type
      );
      r = r.filter((r) => {
        const n = e.properties
          .filter((e) => e.use)
          .map((e) => ({
            key: "get" + t.upperCaseFirstLetter(e.name),
            value: e.value,
          }))
          .map((e) => r[e.key]() === e.value)
          .reduce((e, t) => e && t, true);
        const s = e.bindings
          .filter((e) => e.use)
          .map((e) => {
            const t = r.mBindingInfos[e.propertyName];
            if (!t) {
              return false;
            }
            if (t.parts.length === 1) {
              if (t.parts[0].path !== e.propertyPath) {
                return false;
              }
              if (
                !t.binding ||
                !t.binding.oContext ||
                !(t.binding.oContext.sPath !== e.modelPath)
              ) {
                return false;
              }
              if (!t.binding || !t.binding.oValue !== e.bindingValue) {
                return false;
              }
            } else if (t.parts.length > 1) {
              const r = t.parts.find((t) => e.propertyPath === t.path);
              if (!r) {
                return false;
              }
              const n = t.binding.aBindings.find(
                (t) => t.sPath === e.propertyPath
              );
              if (!n) {
                return false;
              }
              if (n.oValue !== e.bindingValue) {
                return false;
              }
            }
            return true;
          })
          .reduce((e, t) => e && t, true);
        const i = e.i18nTexts
          .filter((e) => e.use)
          .map((e) => {
            const t = r.mBindingInfos[e.propertyName];
            if (!t) {
              return false;
            }
            if (t.parts.length === 1) {
              if (
                t.parts[0].path !== b.propertyPath &&
                t.parts[0].model !== "i18n"
              ) {
                return false;
              }
              if (
                !t.binding ||
                !t.binding.oContext ||
                !(t.binding.oContext.sPath !== b.modelPath)
              ) {
                return false;
              }
              if (!t.binding || !t.binding.oValue !== b.bindingValue) {
                return false;
              }
            } else if (t.parts.length > 1) {
              const e = t.parts
                .filter((e) => e.model && e.model === "i18n")
                .find((e) => b.propertyPath === e.path);
              if (!e) {
                return false;
              }
              const r = t.binding.aBindings.find(
                (e) => e.sPath === b.propertyPath
              );
              if (!r) {
                return false;
              }
              if (r.oValue !== b.bindingValue) {
                return false;
              }
            }
            return true;
          })
          .reduce((e, t) => e && t, true);
        return n && s && i;
      });
      return r;
    }
    executeAction(e) {
      this.#n = false;
      let t;
      if (this.#t) {
        t = this.#a(e.step, e.useSelectors);
      } else {
        t = this.#c(e.step);
      }
      this.#n = true;
      return t;
    }

    showToast(e, t) {
      this.#r.show(e, t);
    }

    getLabelDetails(id, isButton = false) {
      const ctrl = sap.ui.getCore().byId(id);
      if (!ctrl) return null;

      const labels = ctrl.getLabels?.();

      if (isButton) {
        if (labels && labels.length > 0) {
          const labelText = labels[0]?.getText?.();
          if (labelText) {
            return labelText;
          }
        }
        return ctrl.getText?.() ?? ctrl.mProperties?.text ?? ctrl.mProperties?.title ?? null;
      }

      // For normal input fields (labels)
      if (labels && labels.length > 0) {
        return labels[0]?.getText?.() ?? null;
      }

      return null;
    }


    showToastDialog(status, recordDetails, type) {
      // prepare items dynamically
      let items = [];
      // top success message
      if (status === 'success') {
        items.push(new sap.m.Text({
          text: "✅ Steps recorded successfully",
          design: "Bold"
        }));
      } else {
        items.push(new sap.m.Text({
          text: "🚫 Empty click Ignored",
          design: "Bold"
        }));
      }
      // type field value Id path propertypath 
      items.push(new sap.m.Text({ text: " " }));
      if (type) {
        items.push(new sap.m.Label({ text: "Type:", design: "Bold" }));
        items.push(new sap.m.Text({ text: type }));
      }

      if (recordDetails?.text) {
        items.push(new sap.m.Text({ text: " " }));
        items.push(new sap.m.Label({ text: "Field:", design: "Bold" }));
        items.push(new sap.m.Text({ text: recordDetails.text }));
      }

      if (recordDetails?.value) {
        items.push(new sap.m.Text({ text: " " }));
        items.push(new sap.m.Label({ text: "Value:", design: "Bold" }));
        items.push(new sap.m.Text({ text: recordDetails.value }));
      }

      // ID path property path
      if (recordDetails?.id) {
        items.push(new sap.m.Text({ text: " " }));
        items.push(new sap.m.Label({ text: "Id:", design: "Bold" }));
        items.push(new sap.m.Text({ text: recordDetails.id }));
      }

      if (recordDetails?.bindingPath?.path) {
        items.push(new sap.m.Text({ text: " " }));
        items.push(new sap.m.Label({ text: "Path:", design: "Bold" }));
        items.push(new sap.m.Text({ text: recordDetails.bindingPath?.path }));
      }

      if (recordDetails?.bindingPath?.propertyPath) {
        items.push(new sap.m.Text({ text: " " }));
        items.push(new sap.m.Label({ text: "Property Path:", design: "Bold" }));
        items.push(new sap.m.Text({ text: recordDetails.bindingPath?.propertyPath }));
      }
      items.push(new sap.m.Text({ text: " " }));


      const oDialog = new sap.m.Dialog({
        type: "Message",
        showHeader: false,   // no header
        draggable: false,
        resizable: false,
        content: new sap.m.VBox({ items })
      }).addStyleClass("customToastDialog");

      oDialog.open();

      // auto close like a toast
      setTimeout(() => {
        if (oDialog.isOpen()) oDialog.close();
      }, 4000);

      // inject CSS once to position at bottom
      if (!document.getElementById("customToastDialogStyles")) {
        const style = document.createElement("style");
        style.id = "customToastDialogStyles";
        style.innerHTML = `
      .customToastDialog {
        position: fixed !important;
        bottom: 2rem !important;
        top: auto !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: 280px !important;
        border-radius: 8px !important;
        background: rgba(0,0,0,0.85) !important;
        color: white !important;
        text-align: left !important;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      }
      .customToastDialog .sapMDialogScrollCont {
        padding: 1rem !important;
      }
    `;
        document.head.appendChild(style);
      }
    }


    recordStepForInteractiveElements(stepDetails, s) {
      if (!stepDetails.eventDetails.control.recordReplaySelector.searchOpenDialogs) {
        stepDetails.shouldStepBeRecorded = true;
      }
      let recordStepDetails = this.recordStepForButton(s, stepDetails, true);
      if (recordStepDetails?.shouldStepBeRecorded) {
        s.send_record_step(JSON.parse(JSON.stringify(recordStepDetails.eventDetails)));
        // if property path is blank 
        this.toastDisplayBasedOnControl('success', recordStepDetails, 'Button');
      }
      else {
        this.toastDisplayBasedOnControl('failure');
      }
    }
    /**
 * Checks if a control supports any press-like event (Button, Link, Icon, ListItem, etc.)
 */
    isTableRowActionIconClick(ctrl) {
      if (!ctrl) return false;
      const type = ctrl.getMetadata?.().getName?.() || "";
      return (
        type.includes("Link") ||
        type.includes("Icon")
      );
    }

    getTableContextForControl(ctrl) {
      if (!ctrl) return null;
      let parent = ctrl;
      let depth = 0;

      while (parent && depth < 20) {
        const ctx = parent.getBindingContext?.();
        if (ctx && typeof ctx.getPath === "function") {
          let table = parent;
          while (table && !/\bTable\b/.test(table.getMetadata?.().getName?.() || "")) {
            table = table.getParent?.();
          }
          return {
            table,
            tableName: table?.getMetadata?.().getName?.(),
            rowContext: ctx,
            rowPath: ctx.getPath(),
            rowData: ctx.getObject?.(),
          };
        }
        parent = parent.getParent?.();
        depth++;
      }
      return null;
    }


    getTableDetails(oTable) {
      return new Promise((resolve) => {
        if (typeof oTable.attachRowSelectionChange !== "function") {
          resolve(undefined); // immediately resolve with undefined
          return;
        }
        let tableRecord = { rowContext: null, rowIndex: null };
        oTable.attachRowSelectionChange(function (oEvent) {
          var indices = oEvent.getParameter("rowIndices"); // selected row indices // [6]
          var rowIndex = indices && indices[0];// 6
          var rowContext = oTable.getContextByIndex(rowIndex)
          console.log("✅ Checkbox clicked in table!");
          console.log("Row index:", rowIndex);
          console.log("Row context path:", rowContext ? rowContext.getPath() : "N/A"); // 9
          console.log("Row data:", rowContext ? rowContext.getObject() : "N/A");
          tableRecord.rowContext = rowContext;
          tableRecord.rowIndex = rowIndex;
          tableRecord.value = oTable.isIndexSelected(rowIndex);
          resolve(tableRecord);
        });
      });
    }

    getControlFromEvent(e) {
      let el = e?.target;
      while (el) {
        if (el.id) {
          const ctrl = sap.ui.getCore().byId(el.id);
          if (ctrl) return ctrl;
        }
        el = el.parentElement;
      }
      return null;
    }

    checkTableCellClick(e) {
      const ctrl = this.getControlFromEvent(e);
      if (!ctrl) return false;

      // 1️⃣ must be label/text-like (getText() but not getValue())
      const isLabelLike =
        typeof ctrl.getText === "function" && typeof ctrl.getValue !== "function";
      if (!isLabelLike) return false;

      // 2️⃣ climb up UI5 parents (not DOM)
      let parent = ctrl;
      let depth = 0;

      while (parent && depth < 20) {
        const md = parent.getMetadata?.();
        if (!md) break;

        // unwrap SmartTable if any
        if (typeof parent.getTable === "function") {
          parent = parent.getTable();
          depth++;
          continue;
        }

        const name = md.getName?.() || "";
        const hasRowAggregation =
          typeof parent.getRows === "function" || typeof parent.getItems === "function";

        // ✅ any table-like control (generic, no hardcoding)
        if (/\bTable\b/.test(name) && hasRowAggregation) {
          const rows = parent.getRows?.() || parent.getItems?.() || [];
          for (const row of rows) {
            const cells = row.getCells?.() || row.getAggregation?.("cells") || [];
            for (const cell of cells) {
              if (cell === ctrl) return true;
              if (cell.findAggregatedObjects?.()?.includes(ctrl)) return true;
            }
          }
          return false; // header/footer/toolbar label
        }

        // 🚫 stop if we reach a list-like non-table structure
        const isListLike =
          /\bList\b/.test(name) &&
          !/\bTable\b/.test(name) &&
          (typeof parent.getItems === "function" || typeof parent.getAggregation === "function");
        if (isListLike) return false;

        parent = parent.getParent?.();
        depth++;
      }

      return false;
    }

    recordStepForValueHelp(s, n, stepDetails) {
      // whenever the button next to field for choosing input is clicked
      // the below code is triggered (value help click)
      // then we attach a change listener on the main input field and when the value changes we get the value and send it to the recorder.
      // this way we are preventing the click value help step from being logged. 
      console.log("⏩ Skipping captured ValueHelp icon");
      return new Promise((resolve) => {
        this.#captureValueHelp.attachChange(evt => {
          const id = evt.mParameters.id;
          const fieldValue = evt.getParameter("value");
          this.#t.findControlSelectorByDOMElement({ domElement: n.getDomRef() })
            .then((ev) => {
              var inputId1 = id;
              if (inputId1) {
                var inputttt = sap.ui.getCore().byId(inputId1);
                if (inputttt && typeof inputttt.getValue === "function") {
                  const finalVal = fieldValue;
                  console.log("✅ Final value in field:", finalVal);
                  stepDetails.eventDetails.value = finalVal; // overwrite whatever was captured during typing
                  stepDetails.eventDetails.control.id = inputId1;
                  stepDetails.eventDetails.control.recordReplaySelector.id = inputId1;
                  stepDetails.eventDetails.control.recordReplaySelector.value = fieldValue;
                  if (!stepDetails.eventDetails.control.recordReplaySelector.bindingPath) {
                    stepDetails.eventDetails.control?.recordReplaySelector.bindingPath = ev?.ancestor?.bindingPath;
                    stepDetails.eventDetails.control?.recordReplaySelector.controlType = ev?.ancestor?.controlType;
                  }
                  stepDetails = this.setRecordStepDetails(stepDetails);
                  resolve(stepDetails);
                }
              }
            });
        }
        );
      });
    }

    recordStepForButton(s, stepDetails, isButton) {
      stepDetails = this.setRecordStepDetails(stepDetails, isButton);
      return stepDetails;
    }


    setRecordStepDetails(stepDetails, isButtonClick = false, isKeyPress = false) {
      //if (isButtonClick || isKeyPress) {
      if (!stepDetails.eventDetails.control.recordReplaySelector?.id) {
        stepDetails.eventDetails.control.recordReplaySelector.id = stepDetails.eventDetails.control.id;
      }
      //}

      let labelField = this.getLabelDetails(stepDetails.eventDetails.control.recordReplaySelector?.id, isButtonClick);
      if (!labelField) {
        labelField = this.setControlFieldText(labelField, stepDetails.eventDetails.control.recordReplaySelector);
      }
      stepDetails.eventDetails.control.recordReplaySelector.text = labelField;
      return stepDetails;

    }

    toastDisplayBasedOnControl(status, stepDetails, type) {
      let propertyField = stepDetails?.eventDetails?.control?.recordReplaySelector;
      this.showToastDialog(status, propertyField, type);
      // if (status !== 'success') {
      //   this.showToastDialog('failure');
      // }
      // else if (isButton && propertyField?.text) {
      //   this.showToastDialog(status, null, propertyField, type);
      // }
      // else {
      //   this.showToastDialog(status,propertyField, type);
      // }
    }

    recordStepsOnkeyPress(s, n, stepDetails) {
      if (!stepDetails.eventDetails.control.recordReplaySelector.id) {
        stepDetails.eventDetails.control.recordReplaySelector.id = stepDetails.eventDetails.control.id;
      }
      if (typeof n.attachChange === "function") {
        n.attachChange((oEvent) => {
          setTimeout(() => {
            this.#t.findControlSelectorByDOMElement({ domElement: n.getDomRef() })
              .then((e) => {
                stepDetails.eventDetails.control.recordReplaySelector = e;
                var inputId1 = stepDetails.eventDetails.control.id;
                if (inputId1) {
                  var inputttt = sap.ui.getCore().byId(inputId1);
                  if (inputttt && typeof inputttt.getValue === "function") {
                    const finalVal = inputttt.getValue();
                    stepDetails.eventDetails.control.recordReplaySelector.value = inputttt.getValue();
                    console.log("✅ Final value in field:", finalVal);
                    stepDetails.eventDetails.key = finalVal; // overwrite whatever was captured during typing
                    stepDetails = this.setRecordStepDetails(stepDetails, false, true);
                    this.sendStepToRecorder(s, stepDetails);
                  }
                }
              });
          }, 500);
        });
      }
    }

    sendStepToRecorder(s, stepRecordDetails) {
      if (stepRecordDetails.shouldStepBeRecorded) {
        s.send_record_step(JSON.parse(JSON.stringify(stepRecordDetails.eventDetails)));
        this.toastDisplayBasedOnControl('success', stepRecordDetails, 'KeyPress');
      } else {
        this.toastDisplayBasedOnControl('failure');
      }
    }

    setControlFieldText(text, record) {
      if (!text) {
        text = record?.bindingPath?.propertyPath;
        if (!text) {
          text = record.id;
        }
        return text;
      }
    }


    getUI5Version() {
      return sap.ui.version;
    }

    getControlFromDomId(domId) {
      if (!domId) return null;

      // Try direct lookup
      var oControl = sap.ui.getCore().byId(domId);
      if (oControl) return oControl;

      // Strip common suffixes
      var suffixes = ["-inner", "-text", "-input", "-icon", "-label"];
      for (var i = 0; i < suffixes.length; i++) {
        if (domId.endsWith(suffixes[i])) {
          var baseId = domId.slice(0, -suffixes[i].length);
          oControl = sap.ui.getCore().byId(baseId);
          if (oControl) return oControl;
        }
      }

      // As a last resort: map DOM → nearest UI5 control
      var oDom = document.getElementById(domId);
      if (oDom) {
        var closestWithId = oDom.closest("[id]");
        if (closestWithId) {
          oControl = sap.ui.getCore().byId(closestWithId.id);
          if (oControl) return oControl;
        }
      }

      return null;
    }

    #s = (e) => {
      var e = e || window.event;
      var t = e.target || e.srcElement;
      var r = this.#u(t);
      if (r && r.addStyleClass) {
        r.addStyleClass("injectClass");
      }
      if (
        this.#e &&
        this.#e.removeStyleClass &&
        r &&
        this.#e.getId() !== r.getId()
      ) {
        this.#e.removeStyleClass("injectClass");
      }
      this.#e = r;
    };
    #i = (e) => {
      var e = e || window.event;
      var t = e.target || e.srcElement;
      var r = this.#u(t);
      if (r && r.removeStyleClass) {
        r.removeStyleClass("injectClass");
      }
    };

    // our Code 
    // F9 help and click on fields to log details start
    #k = (evt) => {
      if (!this.#n) {
        return;
      }

      let t = evt || window.event;
      let r = t.target || t.srcElement;
      let n = this.#u(r);
      const s = window?.ui5TestRecorder?.communication?.webSocket;

      if (!n || !s) {
        return;
      }

      this.#t
        .findControlSelectorByDOMElement({ domElement: n.getDomRef() })
        .then((selector) => {

          // ✅ Special condition: Activate capture mode on F9
          if (evt.key === "F9") {
            console.log("Capture mode activated. Click on a table cell to record its value.");
            // capture the click event after the F9 Block Start
            const handler = (clickEvt) => {
              clickEvt.preventDefault();
              clickEvt.stopPropagation();

              const domId = clickEvt.target.id;
              const control = this.getControlFromDomId(domId);

              if (control) {
                let value = null;
                if (typeof control.getValue === "function") value = control.getValue();
                else if (typeof control.getText === "function") value = control.getText();
                else if (control.getDomRef) value = control.getDomRef().innerText;

                let rowData = null;
                if (control.getBindingContext()) {
                  rowData = control.getBindingContext().getObject();
                }

                const eventDetails = {
                  type: "clicked",
                  control: {
                    id: domId,
                    type: control.getMetadata().getElementName(),
                    classes: control.aCustomStyleClasses,
                    properties: this.#d(control),
                    bindings: this.#m(control),
                    view: this.#p(control),
                    events: {
                      press:
                        n.getMetadata().getEvent("press") !== undefined ||
                        n.getMetadata().getEvent("click") !== undefined,
                    },
                  },
                  location: window.location.href,
                };
                eventDetails.control.recordReplaySelector = { id: domId, value: value, rows: rowData, bindingPath: eventDetails?.control?.bindings };
                let stepDetails = { eventDetails: eventDetails };
                stepDetails = this.setRecordStepDetails(stepDetails);
                s.send_record_step(JSON.parse(JSON.stringify(stepDetails.eventDetails)));
                this.toastDisplayBasedOnControl('success', stepDetails, 'Cell Capture');
                // Remove handler after one click
                document.removeEventListener("click", handler, true);
              } else {
                console.warn("❌ No UI5 control found for", domId);
              }
            };
            // capture the click event after the F9 Block End
            document.addEventListener("click", handler, true);
          }
        })
        .catch((err) => {
          console.error("Keydown handler error:", err.message);
        });
    };
    // F9 help and click on fields to log details end
    // our Code 

    #o = (e) => {
      if (!this.#n) {
        return;
      }
      const origEvent = e || window.event; // ✅ store reference before reassigning e
      let t = origEvent;
      //let t = e || window.event;
      let r = t.target || t.srcElement;
      let n = this.#u(r);
      const s = window?.ui5TestRecorder?.communication?.webSocket;
      if (s) {
        const e = {
          type: "clicked",
          control: {
            id: n?.sId,
            type: n.getMetadata().getElementName(),
            classes: n.aCustomStyleClasses,
            properties: this.#d(n),
            bindings: this.#m(n),
            view: this.#p(n),
            events: {
              press:
                n.getMetadata().getEvent("press") !== undefined ||
                n.getMetadata().getEvent("click") !== undefined,
            },
          },
          location: window.location.href,
        };
        this.#t
          .findControlSelectorByDOMElement({ domElement: n.getDomRef() })
          .then((t) => {
            // our code
            e.control.recordReplaySelector = t;
            const tableCtx = this.getTableContextForControl(n);
            const isTableLabelCell = typeof n.getText === "function" && typeof n.getValue !== "function"
            const isNavigation = this.isTableRowActionIconClick(n);
            // all click events including click on an input field comes here.We want to record only if the click is on a button
            // navigation or similar fields, also for value help. 

            // ********************** Fire Press/ Fire Title Press Block  Start*************//            
            if (typeof n.firePress === "function" || typeof n.fireTitlePress === "function") {
              let stepDetails = { shouldStepBeRecorded: false, eventDetails: e };

              // *****************Value Help Block Start********************************// 
              if (this.#captureValueHelp && n.getParent?.() === this.#captureValueHelp) {
                // it triggers for all the value help fields
                // search open dialogs tell us it is a interim step or not 
                if (!stepDetails.eventDetails.control.recordReplaySelector.searchOpenDialogs) {
                  stepDetails.shouldStepBeRecorded = true;
                }
                this.recordStepForValueHelp(s, n, stepDetails).then((recordStepDetails) => {
                  if (recordStepDetails?.shouldStepBeRecorded) {
                    s.send_record_step(JSON.parse(JSON.stringify(recordStepDetails.eventDetails)));
                    this.toastDisplayBasedOnControl('success', recordStepDetails, 'Value Help');
                  } else {
                    this.toastDisplayBasedOnControl('failure');
                  }
                });
                return;
              }
              // ******************Value Help Block End **********************************//

              // ******************Capture Icon/Button/Navigation/Links click in table Block Start *************************//
              if (tableCtx && isNavigation) {
                console.log("✅ Icon inside table row detected:", tableCtx);

                e.control.recordReplaySelector.bindingPath = {
                  path: tableCtx.rowPath,
                  propertyPath: Object.keys(n.mBindingInfos || {})[0] || null
                };

                e.control.recordReplaySelector.tableId = tableCtx.table.getId(); // full UI5 ID
                e.control.recordReplaySelector.value = tableCtx.rowData;
                e.control.recordReplaySelector.id = n.getId();

                stepDetails.shouldStepBeRecorded = true;
                this.recordStepForInteractiveElements(stepDetails, s);
                return;
              }
              //*****************Capture Icon Icon/Button/Navigation/Links in table Block End ************/

              // ****************Button/Links/Navigation/Icons and controls apart from Value Help/Table field Block Start ********//
              this.recordStepForInteractiveElements(stepDetails, s);
              // ****************Button/Links/Navigation/Icons and controls apart from Value Help/Table field Block End ********//
            }
            // ********************** Fire Press/ Fire Title Press Block  End*************//

            //**********************Not Fire Press nor Fire Title Press Block Start************************//
            else {
              let stepDetails = { shouldStepBeRecorded: false, eventDetails: e };
              let oTable = sap.ui.getCore().byId(e.control.id);
              if (oTable) {
                this.getTableDetails(oTable).then((tableRecordDetails) => {

                  // ************Table Block Start if the control is a table row selection**************//
                  if (tableRecordDetails) {
                    let recordDetails = e.control.recordReplaySelector;
                    if (!e.control.recordReplaySelector?.id) {
                      recordDetails.id = e.control.id;
                    }
                    // replace path for table
                    if (recordDetails.bindingPath) {
                      recordDetails.bindingPath.path = tableRecordDetails.rowContext.getPath();
                    }
                    // check if not in dialog
                    if (!recordDetails.searchOpenDialogs) {
                      stepDetails.shouldStepBeRecorded = true;
                    }
                    let recordStepDetails = this.recordStepForButton(s, stepDetails);
                    recordStepDetails.eventDetails.control.recordReplaySelector.value = tableRecordDetails.value;
                    if (recordStepDetails?.shouldStepBeRecorded) {
                      s.send_record_step(JSON.parse(JSON.stringify(recordStepDetails.eventDetails)));
                      // if property path is blank 
                      this.toastDisplayBasedOnControl('success', recordStepDetails, 'Table');
                    }
                    this.showToastDialog('success', recordDetails, 'Clicked');
                  }
                  // ************Table Block End if the control is a table row selection**************//

                  // ************Not a Table row Selection block Start if the control is other than table row selection**************//
                  else {

                    let stepDetails = { shouldStepBeRecorded: false, eventDetails: e };

                    // ************Checkbox/Radio Block Start if the control is a checkbox/radio**************//

                    // Generic attach for controls that support "select" event
                    if (typeof n.attachSelect === "function" && !n._customSelectAttached) {
                      n._customSelectAttached = true; // ✅ Attach only once

                      n.attachSelect((evt) => {
                        // Try to detect selected state dynamically
                        const selected =
                          evt.getParameter("selected") ??
                          evt.getParameter("selectedItem") ??
                          evt.getParameter("value") ??
                          null;

                        // ✅ Deduplicate: only record on state change
                        if (n._lastSelected !== selected) {
                          n._lastSelected = selected;

                          e.value = selected;
                          e.control.value = selected;

                          if (e.control.properties) {
                            // If control supports "selected"
                            if ("selected" in e.control.properties) {
                              e.control.properties.selected = selected;
                            }
                            // If control supports "selectedKey"
                            if ("selectedKey" in e.control.properties) {
                              e.control.properties.selectedKey = selected;
                            }
                            // If control supports "selectedIndex"
                            if ("selectedIndex" in e.control.properties) {
                              e.control.properties.selectedIndex = selected;
                            }
                          }
                          console.log("📌", e.control?.type, "→", selected);
                          if (!stepDetails.eventDetails.control.recordReplaySelector.searchOpenDialogs) {
                            stepDetails.shouldStepBeRecorded = true;
                          }
                          let recordStepDetails = this.recordStepForButton(s, stepDetails);
                          recordStepDetails.eventDetails.control.recordReplaySelector.value = selected;
                          if (recordStepDetails?.shouldStepBeRecorded) {
                            s.send_record_step(JSON.parse(JSON.stringify(recordStepDetails.eventDetails)));
                            this.toastDisplayBasedOnControl('success', recordStepDetails, 'Checkbox/Radio');
                          }
                        }
                      });
                    }
                    // ************Checkbox/Radio Block End if the control is a checkbox/radio**************//

                    // ************Capture property path/path for individual click on table cell  Block Start**************/
                    // else if (isRequiredToLogDetails) {
                    else if (tableCtx && isTableLabelCell) {
                      e.control.recordReplaySelector.tableId = tableCtx.table?.getId?.();
                      this.recordStepForInteractiveElements(stepDetails, s);
                    }
                    //}
                    // ************Capture property path/path for individual click on table cell clicks Block End**************/

                    else {
                      // if other than table rowselection,checkbox,radio //
                      this.toastDisplayBasedOnControl('failure');
                    }
                  }
                  // ************Not a Table row Selection block End if the control is other than table row selection**************//
                  console.log("Listener attached to SmartTable for rowSelectionChange ✅");
                });
              } else {
                console.log("❌ Table not found. Check the control ID again.");
                this.toastDisplayBasedOnControl('failure');
              }
            }
            //**********************Not Fire Press nor Fire Title Press Block End************************//

            // our code

          })
          .catch((e) => {
            console.log(e.message);
          });
        if (n && n.focus) {
          n.focus();
          let e = n.getDomRef().querySelectorAll("input, select, textarea");
          if (e.length === 0 && n.getDomRef().shadowRoot) {
            e = n
              .getDomRef()
              .shadowRoot.querySelectorAll("input, select, textarea");
          }
          //asd
          for (let t of e) {
            t.onkeypress = (e) => {
              const t = {
                type: "keypress",
                key: e.key,
                keyCode: e.keyCode,
                control: {
                  id: n.sId,
                  type: n.getMetadata().getElementName(),
                  classes: n.aCustomStyleClasses,
                  properties: this.#d(n),
                  bindings: this.#m(n),
                  view: this.#p(n),
                  events: {
                    press: n.getMetadata().getEvent("press") !== undefined,
                  },
                },
                location: window.location.href,
              };
              this.#t
                .findControlSelectorByDOMElement({ domElement: n.getDomRef() })
                .then((e) => {
                  // our code
                  // ************** Keypress Block Start ***********//
                  t.control.recordReplaySelector = e;
                  let stepDetails = { shouldStepBeRecorded: false, eventDetails: t };
                  if (!stepDetails.eventDetails.control.recordReplaySelector.searchOpenDialogs) {
                    stepDetails.shouldStepBeRecorded = true;
                  }
                  this.recordStepsOnkeyPress(s, n, stepDetails);
                  //************* Key Press Block End *************/

                  // our code
                })

                .catch((e) => {
                  console.log(e.message);
                });
            };
          }

          //asd
        }
      } else {
        console.error(
          "UI5-Testrecorder: ",
          "No communication websocket found!"
        );
      }
    };
    #u(e) {
      let t = this.#l();
      var r = t[e.id];
      if (!r || (r && !r.getParent())) {
        let n = e;
        let s = false;
        while (!s) {
          if (n && t[n.id] && t[n.id].getParent() && t[n.id].addStyleClass) {
            s = true;
            r = t[n.id];
          }
          n = n.parentNode;
          if (!n) {
            break;
          }
        }
      }
      return r;
    }
    #l() {
      if (sap.ui.core.Element && sap.ui.core.Element.registry) {
        return this.#g();
      } else {
        return this.#h();
      }
    }
    #h() {
      let e;
      const t = { startPlugin: (t) => (e = t), stopPlugin: (e) => { } };
      sap.ui.getCore().registerPlugin(t);
      sap.ui.getCore().unregisterPlugin(t);
      return e.mElements;
    }
    #g() {
      return sap.ui.core.Element.registry.all();
    }
    #d(e) {
      return e
        .getMetadata()
        ._aAllPublicMethods.filter((e) => e.startsWith("get"))
        .reduce((r, n) => {
          const s = t.lowerCaseFirstLetter(n.replace("get", ""));
          try {
            const t = e[n]();
            if (typeof t !== "object") {
              r[s] = t;
            } else if (typeof t === "function" || t.then) {
              return r;
            } else {
              try {
                JSON.stringify(t);
                r[s] = t;
              } catch (e) { }
            }
            return r;
          } catch (e) {
            return r;
          }
        }, {});
    }

    // start of commented code - original
    // #m(e) {
    //     const t = Object.keys(e.mBindingInfos)
    //         .map((t) => {
    //             // if parts is available
    //             let r = e.mBindingInfos[t].parts.map((e) => {
    //                 const r = {};
    //                 r.key = t;
    //                 r.i18n = e.model === "i18n";
    //                 r.propertyPath = e.path;
    //                 r.model = e.model;
    //                 return r;
    //                 // else parts is not available then r = r.propertyPath = path;
    //             });
    //             if (r.length > 1) {
    //                 r = r.map((t) => {
    //                     const r = e.mBindingInfos[t.key].binding.aBindings.find(
    //                         (e) => e.sPath === t.propertyPath
    //                     );
    //                     if (r) {
    //                         t.modelPath = r.oContext?.sPath;
    //                         t.value = r.oValue;
    //                     }
    //                     return t;
    //                 });
    //             } else if (r.length === 1) {
    //                 const t = e.mBindingInfos[r[0].key].binding;
    //                 if (t) {
    //                     r[0].modelPath = t.oContext?.sPath;
    //                     r[0].value = t.oValue;
    //                 }
    //             }
    //             return r;
    //         })
    //         .reduce((e, t) => [...t, ...e], []);
    //     const r = Object.keys(e.oPropagatedProperties.oModels)
    //         .map((t) => {
    //             const r = e.getBindingContext(t);
    //             if (r) {
    //                 return { model: t, contextPath: r.getPath() };
    //             }
    //         })
    //         .filter((e) => e);
    //     return [...t, ...r];
    // }

    // 
    // end of commented code 

    // code changes 
    // earlier used function above assumes that e.mBindingInfos[t].parts is always defined, 
    // but in some cases it’s undefined (or null), so map breaks.
    // now the function below always returns a valid array even if some bindings are missing/undefined and
    // get the bindingpath directly e.mBindingInfos[t].path if the e.mBindingInfos[t].parts is undefined

    #m(e) {
      const t = Object.keys(e.mBindingInfos)
        .map((t) => {
          // if parts is available
          let r = e.mBindingInfos[t].parts?.map((e) => {
            const r = {};
            r.key = t;
            r.i18n = e.model === "i18n";
            r.propertyPath = e.path;
            r.model = e.model;
            return r;
            // else parts is not available then r = r.propertyPath = path;
          });
          if (r === undefined) {
            const r = [];
            const details = {};
            details.key = t;
            details.i18n = e.model === "i18n";
            details.propertyPath = e.mBindingInfos[t].path;
            details.model = e.model;
            r.push(details);
            return r
          }
          if (r?.length > 1) {
            r = r.map((t) => {
              const r = e.mBindingInfos[t.key].binding.aBindings.find(
                (e) => e.sPath === t.propertyPath
              );
              if (r) {
                t.modelPath = r.oContext?.sPath;
                t.value = r.oValue;
              }
              return t;
            });
          } else if (r?.length === 1) {
            const t = e.mBindingInfos[r[0].key].binding;
            if (t) {
              r[0].modelPath = t.oContext?.sPath;
              r[0].value = t.oValue;
            }
          }
          return r;
        })
        .reduce((e, t) => [...t, ...e], []);
      const r = Object.keys(e.oPropagatedProperties.oModels)
        .map((t) => {
          const r = e.getBindingContext(t);
          if (r) {
            return { model: t, contextPath: r.getPath() };
          }
        })
        .filter((e) => e);
      return [...t, ...r];
    }

    #p(e) {
      let t = e;
      while (t && !t.getViewName) {
        t = t.getParent();
      }
      if (!t) {
        const r = e.getId().substring(0, e.getId().lastIndexOf("-"));
        t = this.#l()[r];
        while (t && !t.getViewName) {
          t = t.getParent();
        }
      }
      return {
        absoluteViewName: t?.getViewName() || "",
        relativeViewName: t?.getViewName().split(".").pop() || "",
      };
    }
    #a(e, t) {
      const r = t ? this.#f(e) : e.recordReplaySelector;
      switch (e.actionType) {
        case "clicked":
          return this.#t.interactWithControl({
            selector: r,
            interactionType: this.#t.InteractionType.Press,
          });
        case "validate":
          return this.#t
            .findAllDOMElementsByControlSelector({ selector: r })
            .then((e) => {
              if (e.length > 1) {
                throw new Error();
              }
              return;
            });
        case "input":
          return this.#t.interactWithControl({
            selector: r,
            interactionType: this.#t.InteractionType.EnterText,
            enterText: e.keys.reduce((e, t) => e + (t.key || ""), ""),
          });
        default:
          return Promise.reject("ActionType not defined");
      }
    }
    #f(e) {
      const t = {};
      if (e.control.controlId.use) {
        t["id"] = e.control.controlId.id;
        return t;
      }
      t["controlType"] = e.control.type;
      if (e.control.bindings) {
        const r = e.control.bindings.filter((e) => e.use);
        if (r.length === 1) {
          t["bindingPath"] = {
            path: r[0].modelPath,
            propertyPath: r[0].propertyPath,
          };
        }
      }
      if (e.control.i18nTexts) {
        const r = e.control.i18nTexts.filter((e) => e.use);
        if (r.length === 1) {
          t["i18NText"] = {
            key: r[0].propertyPath,
            propertyName: r[0].propertyName,
          };
        }
      }
      if (e.control.properties) {
        const r = e.control.properties.filter((e) => e.use);
        if (r.length > 0 && !t.properties) {
          t.properties = {};
        }
        r.forEach((e) => {
          t.properties[e.name] = e.value;
        });
      }
      if (e.recordReplaySelector.viewId) {
        t["viewId"] = e.recordReplaySelector.viewId;
      }
      return t;
    }
    #c(e) {
      let t = this.#l();
      if (e.control.controlId.use) {
        t = t.filter((t) => t.getId() === e.control.controlId);
      } else {
        t = this.getElementsBySelectors(e.control);
      }
      if (t.length !== 1) {
        return Promise.reject();
      }
      switch (e.action_type) {
        case "clicked":
          this.#y(t[0].getDomRef());
          return Promise.resolve();
        case "validate":
          return Promise.resolve();
        case "input":
          this.#v(t[0], e);
          return Promise.resolve();
        default:
          return Promise.reject(`Action Type (${e.actionType}) not defined`);
      }
    }
    #y(e) {
      const t = new MouseEvent("mousedown", {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      t.originalEvent = t;
      var r = new MouseEvent("mouseup", {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      r.originalEvent = r;
      var n = new MouseEvent("click", {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      n.originalEvent = n;
      e.dispatchEvent(t);
      e.dispatchEvent(r);
      e.dispatchEvent(n);
    }
    #v(e, t) {
      const r = e.getDomRef();
      const n = t.keys.reduce((e, t) => e + t.keyChar, "");
      r.val(n);
      var s = new KeyboardEvent("input", {
        view: window,
        data: n,
        bubbles: true,
        cancelable: true,
      });
      s.originalEvent = s;
      r.dispatchEvent(s);
    }
  }
  class t {
    static lowerCaseFirstLetter([e, ...t], r = navigator.language) {
      return e === undefined ? "" : e.toLocaleLowerCase(r) + t.join("");
    }
    static upperCaseFirstLetter = ([e, ...t], r = navigator.language) =>
      e === undefined ? "" : e.toLocaleUpperCase(r) + t.join("");
  }
  const r = new e(document, window);
  r.enableRecording();
  r.showToast("Qyrus Fiori Recorder successfully injected", {
    duration: 2e3,
    autoClose: true,
  });
  window.ui5TestRecorder = {
    ...window.ui5TestRecorder,
    ...{ recorder: r, utils: new t() },
  };
})();
//# sourceMappingURL=page_inject.js.map
