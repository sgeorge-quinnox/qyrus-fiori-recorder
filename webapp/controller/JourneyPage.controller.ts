import JSONModel from "sap/ui/model/json/JSONModel";
import BaseController from "./BaseController";
import JourneyStorageService from "../service/JourneyStorage.service";
import Event from "sap/ui/base/Event";
import DateFormat from "sap/ui/core/format/DateFormat";
import UI5Element from "sap/ui/core/Element";
import BusyIndicator from "sap/ui/core/BusyIndicator";
import Utils from "../model/class/Utils.class";
import Dialog from "sap/m/Dialog";
import { ButtonType, DialogType, FlexAlignContent, FlexAlignItems } from "sap/m/library";
import Button from "sap/m/Button";
import Text from "sap/m/Text";
import MessageToast from "sap/m/MessageToast";
import Journey from "../model/class/Journey.class";
import CodeGenerationService from "../service/CodeGeneration.service";
import Menu from "sap/m/Menu";
import Fragment from "sap/ui/core/Fragment";
import SettingsStorageService, { AppSettings } from "../service/SettingsStorage.service";
import { CodeStyles, TestFrameworks } from "../model/enum/TestFrameworks";
import { downloadZip } from "client-zip";
import { ChromeExtensionService } from "../service/ChromeExtension.service";
import { RecordEvent, Step, UnknownStep } from "../model/class/Step.class";
import { RequestBuilder, RequestMethod } from "../model/class/RequestBuilder.class";
import VBox from "sap/m/VBox";
import CheckBox, { CheckBox$SelectEvent } from "sap/m/CheckBox";
import History from "sap/ui/core/routing/History";
import { ValueState } from "sap/ui/core/library";
import ChangeReason from "sap/ui/model/ChangeReason";
import { StepType, CodePage } from "../model/enum/StepType";
import IconTabBar from "sap/m/IconTabBar";
import ManagedObject from "sap/ui/base/ManagedObject";
import Control from "sap/ui/core/Control";
import type { Select$ChangeEvent } from "sap/m/Select";
import type Item from "sap/ui/core/Item";
import type { Input$LiveChangeEvent } from "sap/m/Input";
import Converter from "../controller/converter/converter";
import Message from "sap/ui/core/message/Message";


type ReplayEnabledStep = Step & {
    state?: ValueState;
    executable?: boolean;
}

/**
 * @namespace com.ui5.journeyrecorder.controller
 */
export default class JourneyPage extends BaseController {
    private model: JSONModel;
    private _approveConnectDialog: Dialog;
    private _recordingDialog: Dialog;
    private _replayDialog: Dialog;
    private _frameworkMenu: Menu;
    private _createQyrusDialog?: Dialog;
    private _logoutTimer: any = null;

    async onInit() {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/unbound-method
        this.getRouter().getRoute("journey").attachMatched(this._loadJourney, this);
        // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/unbound-method
        this.getRouter().getRoute("recording").attachMatched(this._recordJourney, this);
        // Dialog form model (defaults)
        const qyrusForm = new JSONModel({
            injectHelpers: true,
            waitEach: true,
            launchUrl: this.getView().getModel("journey")?.getProperty("/startUrl") || "",
            timeout: 30000,
            poll: 200,
            project: "",
            module: "",
            testName: "",
            testDescription: "",
            testObjective: "",

            // NEW: checkbox-driven extras
            optLaunch: true,
            optWaitAfterLaunch: true,
            waitAfterLaunch: 30,   // seconds

            optLogin: true,
            loginUser: "s4h_sd",
            loginPass: "Welcome1",

            optWaitAfterLogin: true,
            waitAfterLogin: 60,    // seconds

            // NEW: OPA5 -> JSON conversion fields
            opa5Input: "",
            outJson: ""
        });
        this.getView().setModel(qyrusForm, "qyrusForm");
        this._advancedTargets = await this._loadAdvancedTargets();

        // Hide them immediately if present…
        this._applyHiddenState(true);

        // …and keep them hidden across re-renders
        this._installObserver();
    }

    onNavBack() {
        void JourneyStorageService.isChanged(Journey.fromObject((this.getModel('journey') as JSONModel).getData() as Partial<Journey>)).then((unsafed: boolean) => {
            if (unsafed) {
                this._openUnsafedDialog({
                    success: () => {
                        void ChromeExtensionService.getInstance().disconnect().then(() => {
                            this.setDisconnected();
                            const sPreviousHash = History.getInstance().getPreviousHash();
                            if (sPreviousHash?.indexOf('recording') > -1) {
                                this.getRouter().navTo("main");
                            } else {
                                super.onNavBack();
                            }
                        });
                    },
                    error: () => {
                        this.byId('saveBtn').focus();
                    }
                });
            } else {
                void ChromeExtensionService.getInstance().disconnect().then(() => {
                    this.setDisconnected();
                    const sPreviousHash = History.getInstance().getPreviousHash();
                    if (sPreviousHash?.indexOf('recording') > -1) {
                        this.getRouter().navTo("main");
                    } else {
                        super.onNavBack();
                    }
                });
            }
        });
    }

    onStepDelete(oEvent: Event) {
        const sPath = (oEvent.getSource() as ManagedObject).getBindingContext('journey')?.getPath() || '';
        if (sPath !== '') {
            const index = Number(sPath.replace('/steps/', ''));
            const jour = this.model.getData() as Journey;
            const steps = jour.steps;
            steps.splice(index, 1);
            this.model.setProperty('/steps', steps);
            this.model.firePropertyChange({
                reason: ChangeReason.Change,
                path: '/steps',
                value: steps
            });
        }
    }

    async onReplay() {
        let settings = (this.getModel('settings') as JSONModel)?.getData() as AppSettings;
        if (!settings) {
            settings = await SettingsStorageService.getSettings();
        }
        (this.getModel('journeyControl') as JSONModel).setProperty('/replaySettings', { delay: settings.replayDelay, manual: settings.manualReplayMode, rrSelectorUse: settings.useRRSelector });
        await this._openReplayDialog();
    }

    onRejectReplay() {
        this._replayDialog.close();
        (this.getModel('journeyControl') as JSONModel).setProperty('/replayEnabled', false);
    }

    async onStartReplay() {
        this._replayDialog.close();
        const replaySettings = (this.getModel('journeyControl') as JSONModel).getProperty('/replaySettings') as { delay: number, manual: boolean, rrSelectorUse: boolean };
        if (!(this.model.getData() as Journey).startUrl) {
            const unknownUrl = new Dialog({
                state: ValueState.Error,
                type: DialogType.Message,
                title: 'Unknown Url!',
                content: new Text({ text: "The current setup don't have a url to start from, this depends on the first step provided.\nRedefine your step setup and try again!" }),
                beginButton: new Button({
                    type: ButtonType.Critical,
                    text: 'Ok',
                    press: () => {
                        unknownUrl.close();
                        unknownUrl.destroy();
                    }
                })
            });
            unknownUrl.open();
            return
        }

        const url = this.model.getProperty('/startUrl') as string;
        await this.onConnect(url);

        (this.getModel('journeyControl') as JSONModel).setProperty('/replayEnabled', true);
        if (!replaySettings.manual) {
            await this._startAutomaticReplay(replaySettings.delay, replaySettings.rrSelectorUse);
        } else {
            MessageToast.show('Replay engaged!');
            this._startManualReplay(replaySettings.rrSelectorUse);
        }
    }

    async onStopReplay() {
        (this.getModel('journeyControl') as JSONModel).setProperty('/replayEnabled', false);
        (this.getModel('journeyControl') as JSONModel).setProperty('/manualReplay', true);
        await this.onDisconnect();
    }
    onChangeReplayDelay(oEvent: Event) {
        const index = oEvent.getParameter("selectedIndex" as never);
        switch (index) {
            case 0:
                (this.getModel("journeyControl") as JSONModel).setProperty('/replaySettings/delay', 0.5);
                break;
            case 1:
                (this.getModel("journeyControl") as JSONModel).setProperty('/replaySettings/delay', 1.0);
                break;
            case 2:
                (this.getModel("journeyControl") as JSONModel).setProperty('/replaySettings/delay', 2.0);
                break;
            default:
                (this.getModel("journeyControl") as JSONModel).setProperty('/replaySettings/delay', 0.5);
        }
    }

    onReorderItems(event: Event) {
        const movedId = (event.getParameter('draggedControl') as ManagedObject).getBindingContext('journey').getObject().id as string;
        const droppedId = (event.getParameter('droppedControl') as ManagedObject).getBindingContext('journey').getObject().id as string;
        this._moveStep(movedId, droppedId);
        this._generateCode(Journey.fromObject(this.model.getData() as Partial<Journey>));
    }

    onAddStep() {
        const steps = (this.model.getData() as Journey).steps;
        steps.push(new UnknownStep());
        this.model.setProperty('/steps', steps);
    }

    private _moveStep(movedStepId: string, anchorStepId: string) {
        let steps = (this.model.getData() as Journey).steps;
        const movedIndex = steps.findIndex(s => s.id === movedStepId);
        const anchorIndex = steps.findIndex(s => s.id === anchorStepId);
        steps = Utils.moveInArray(steps, movedIndex, anchorIndex);
        this.model.setProperty('/steps', steps);
    }

    private async _startAutomaticReplay(delay: number, rrSelectorUse: boolean) {
        BusyIndicator.show(0);
        const journeySteps = (this.model.getData() as Journey).steps as ReplayEnabledStep[];
        for (let index = 0; index < journeySteps.length; index++) {
            await Utils.delay(1000 * delay)
            const curStep = journeySteps[index];
            try {
                this.model.setProperty(`/steps/${index}/state`, ValueState.Information);
                await ChromeExtensionService.getInstance().performAction(curStep, rrSelectorUse);
                this.model.setProperty(`/steps/${index}/state`, ValueState.Success);
            } catch (e) {
                this.model.setProperty(`/steps/${index}/state`, ValueState.Error);
                MessageToast.show('An Error happened during testing', { duration: 3000 });
                BusyIndicator.hide();
                await this.onStopReplay();
                return;
            }
        }
        BusyIndicator.hide();
        await this.onStopReplay();
        MessageToast.show('All tests executed successfully', { duration: 3000 });
    }

    private _startManualReplay(rrSelectorUse: boolean) {
        const model = (this.getModel('journeyControl') as JSONModel);

        model.setProperty('/manualReplay', true);
        model.setProperty('/manualReplayIndex', 0);
        model.setProperty('/manualReplayRRSelector', rrSelectorUse);
        this.model.setProperty(`/steps/0/executable`, true);
    }

    public async executeTestStep() {
        const journeySteps = (this.model.getData() as Journey).steps as ReplayEnabledStep[];
        const model = (this.getModel('journeyControl') as JSONModel);
        const index = model.getProperty('/manualReplayIndex') as number;
        const rrSelectorUse = model.getProperty('/manualReplayRRSelector') as boolean;

        const curStep = journeySteps[index];
        try {
            this.model.setProperty(`/steps/${index}/state`, ValueState.Information);
            await ChromeExtensionService.getInstance().performAction(curStep, rrSelectorUse);
            this.model.setProperty(`/steps/${index}/state`, ValueState.Success);
            model.setProperty('/manualReplayIndex', index + 1);
            this.model.setProperty(`/steps/${index}/executable`, false);

            if (index === (journeySteps.length - 1)) {
                await this.onStopReplay();
                MessageToast.show('All tests executed successfully', { duration: 3000 });
                return;
            }

            if (journeySteps[index + 1].actionType === StepType.UNKNOWN) {
                this.model.setProperty(`/steps/${index + 1}/state`, ValueState.Error);
                this.model.setProperty(`/steps/${index + 1}/executable`, false);
                const unknownStepDialog = new Dialog({
                    state: ValueState.Error,
                    type: DialogType.Message,
                    title: 'Unknown Step!',
                    content: new Text({ text: "The next step defines an unknown action, please redefine the Step and retest again!" }),
                    beginButton: new Button({
                        type: ButtonType.Negative,
                        text: 'Ok',
                        press: () => {
                            unknownStepDialog.close();
                            unknownStepDialog.destroy();
                            BusyIndicator.hide();
                            void this.onStopReplay();
                        }
                    })
                });
                unknownStepDialog.open();
                return;
            }

            if (index + 1 < journeySteps.length) {
                this.model.setProperty(`/steps/${index + 1}/executable`, true);
            }
        } catch (e) {
            this.model.setProperty(`/steps/${index}/state`, ValueState.Error);
            this.model.setProperty(`/steps/${index}/executable`, false);
            MessageToast.show('An Error happened during testing', { duration: 3000 });
            BusyIndicator.hide();
            await this.onStopReplay();
            return;
        }
    }

    navigateToStep(oEvent: Event) {
        const source: UI5Element = oEvent.getSource();
        const bindingCtx = source.getBindingContext('journey');
        const journeyId = ((bindingCtx.getModel() as JSONModel).getData() as Partial<Journey>).id;
        const stepId = bindingCtx.getProperty("id") as string;
        const stepType = bindingCtx.getProperty("actionType") as StepType;
        if (stepType === StepType.UNKNOWN) {
            this.getRouter().navTo('step-define', { id: journeyId, stepId: stepId });
        } else {
            this.getRouter().navTo('step', { id: journeyId, stepId: stepId });
        }
    }

    dateTimeFormatter(value: number) {
        if (value) {
            const oDateFormat = DateFormat.getDateTimeInstance({ pattern: "MM/dd/yyyy - hh:mm" });
            return oDateFormat.format(new Date(value));
        } else {
            return value;
        }
    }
    // ritik added 
    private _hideShowDialog?: Dialog;
    private _hideShowPassword: string = "";

    private _advancedTargets: string[] = [];
    private _isAdvancedHidden: boolean = true;  // default: hidden
    private _advancedObserver?: MutationObserver;


    private async _getHideShowDialog(): Promise<Dialog> {
        if (!this._hideShowDialog || (this._hideShowDialog as any).isDestroyed?.()) {
            const oView = this.getView();
            const dlg = await Fragment.load({
                id: oView.getId(),
                name: "com.ui5.journeyrecorder.fragment.HideShowPasswordDialog",
                controller: this
            }) as Dialog;
            oView.addDependent(dlg);
            this._hideShowDialog = dlg;
        }
        return this._hideShowDialog;
    }

    private async _loadAdvancedTargets(): Promise<string[]> {
        try {
            const url = sap.ui.require.toUrl("com/ui5/journeyrecorder/config/hideShowTargets.json");
            const res = await fetch(url, { cache: "no-store" });
            if (!res.ok) throw new Error(String(res.status));
            const data = await res.json();
            return Array.isArray(data) ? data : Array.isArray(data?.ids) ? data.ids : [];
        } catch (e) {
            console.warn("Failed to load hideShowTargets.json", e);
            return [];
        }
    }

    private _setDisplayById(id: string, display: "" | "none"): void {
        const cleanId = (id || "").replace(/^#/, "");
        const el = document.getElementById(cleanId) as HTMLElement | null;
        if (el) {
            el.style.setProperty("display", display, "important");
        }
    }

    private _applyHiddenState(hidden: boolean): void {
        this._advancedTargets.forEach((id) => this._setDisplayById(id, hidden ? "none" : ""));
    }

    private _installObserver(): void {
        if (this._advancedObserver) return;
        this._advancedObserver = new MutationObserver(() => {
            // Re-apply hidden style on any DOM change to keep things hidden
            if (this._isAdvancedHidden) {
                this._applyHiddenState(true);
            }
        });
        this._advancedObserver.observe(document.body, { childList: true, subtree: true });
    }

    private _removeObserver(): void {
        this._advancedObserver?.disconnect();
        this._advancedObserver = undefined;
    }
    public async onToggleVisibility(): Promise<void> {
        const dlg = await this._getHideShowDialog();
        dlg.open();
    }

    public onHideShowPasswordLiveChange(oEvent: Input$LiveChangeEvent): void {
        this._hideShowPassword = String(oEvent.getParameter("value") ?? "");
    }

    public async onHideShowProceed(): Promise<void> {
        // TODO: replace with real verification later
        MessageToast.show("Verified");

        // Toggle state: if currently hidden, show; else hide again
        if (this._isAdvancedHidden) {
            this._isAdvancedHidden = false;
            this._removeObserver();           // stop forcing hidden
            this._applyHiddenState(false);    // show
            MessageToast.show("Advanced controls shown");
        } else {
            this._isAdvancedHidden = true;
            this._applyHiddenState(true);     // hide
            this._installObserver();          // keep hidden on re-render
            MessageToast.show("Advanced controls hidden");
        }

        const dlg = await this._getHideShowDialog();
        dlg.close();
    }

    public async onHideShowCancel(): Promise<void> {
        const dlg = await this._getHideShowDialog();
        dlg.close();
    }

    // public async onCreateQyrus(): Promise<void> {
    //     const view = this.getView();
    //     if (!this._createQyrusDialog) {
    //         this._createQyrusDialog = await Fragment.load({
    //             id: view.getId(),
    //             name: "com.ui5.journeyrecorder.fragment.CreateQyrusDialog",
    //             controller: this
    //         }) as Dialog;
    //         view.addDependent(this._createQyrusDialog);
    //     }
    //     this._createQyrusDialog.open();
    // }
    public async onCreateQyrus(): Promise<void> {
        const view = this.getView();
        if (!this._createQyrusDialog) {
            this._createQyrusDialog = await Fragment.load({
                id: view.getId(),
                name: "com.ui5.journeyrecorder.fragment.CreateQyrusDialog",
                controller: this
            }) as Dialog;
            view.addDependent(this._createQyrusDialog);
            this._createQyrusDialog.attachAfterOpen(async () => {
                try {
                    const jour = await JourneyStorageService.getInstance().getById(
                        this.model.getProperty('/id') as string
                    );
                    const OPA5TEXT = JSON.parse(jour.toString() || '{}');
                    console.log("Parsed Object:", OPA5TEXT);

                    const form = this.getView().getModel("qyrusForm") as JSONModel; 
                    // ✅ Extract actionLocation from first step (if available)
                    const firstStep = OPA5TEXT.steps && OPA5TEXT.steps.length > 0 ? OPA5TEXT.steps[0] : null;
                    if (firstStep?.actionLocation) {
                        const qyrusFormModel = this.getView().getModel("qyrusForm") as JSONModel;
                        if (qyrusFormModel) {
                            qyrusFormModel.setProperty("/launchUrl", firstStep.actionLocation);
                            console.log("launchUrl set in qyrusForm model:", firstStep.actionLocation);
                        }
                    }

                    const input = {
                        opa5Text: OPA5TEXT,
                        injectHelpers: !!form.getProperty("/injectHelpers"),
                        waitEach: !!form.getProperty("/waitEach"),
                        timeout: Number(form.getProperty("/timeout") ?? 0),
                        poll: Number(form.getProperty("/poll") ?? 0),
                        launch: Boolean(form.getProperty("/optLaunch") ?? true),
                        launchUrl: String(form.getProperty("/launchUrl") ?? ""),
                        waitAfterLaunch: Boolean(form.getProperty("/optWaitAfterLaunch") ?? true),
                        // Login options
                        login: Boolean(form.getProperty("/optLogin") ?? true),
                        loginUser: String(form.getProperty("/loginUser") ?? ""),
                        loginPass: String(form.getProperty("/loginPass") ?? ""),
                        waitAfterLogin: Boolean(form.getProperty("/optWaitAfterLogin") ?? true),
                    };
                    console.log("Converting with input:", input);
                    const result = await Converter.convertToTestSteps(input);

                    if(result.transformationDisplayData) {
                        const transformedWithStep = result.transformationDisplayData.map((step: any, i: number) => ({
                            stepNumber: i + 1,
                            actionType: step.actionType ?? "",
                            fieldName: step.text ?? "",
                            fieldValue: step.value ?? ""
                        }));
                        // ✅ Bind steps model to dialog
                        const stepsModel = new JSONModel(transformedWithStep);
                        this._createQyrusDialog.setModel(stepsModel, "steps");
                    }
                    
                    if(result.logs) {
                        const transformedWithLogs = result.logs.map((log: any, i: number) => ({
                            stepNumber: i + 1,
                            type: log.level ?? "",
                            message: log.msg ?? "",
                        }));
                        const logsModel = new JSONModel(transformedWithLogs);
                        this._createQyrusDialog.setModel(logsModel, "logs");
                    }
                    

                    // const transformedRecordedData = await Converter.getTransformedOPA5Data(OPA5TEXT);

                    // const transformedWithStep = transformedRecordedData.map((step: any, i: number) => ({
                    //     stepNumber: i + 1,
                    //     actionType: step.actionType ?? "",
                    //     fieldName: step.text ?? "",
                    //     fieldValue: step.value ?? ""
                    // }));
                    // console.log("Transformed OPA5 Data:", transformedWithStep);
                    // // ✅ Bind steps model to dialog
                    // const stepsModel = new JSONModel(transformedWithStep);
                    // this._createQyrusDialog.setModel(stepsModel, "steps");

                    
                    await this.onConvertOpa5();

                } catch (err) {
                    console.error("Error transforming journey:", err);
                }
            });
        }
        this._createQyrusDialog.open();
    }

    public async onCancelCreateQyrus(): Promise<void> {
        const dlg: any = this._createQyrusDialog;
        const form = this.getView().getModel("qyrusForm") as JSONModel;

        // If there is no token, just close.
        const hasToken = !!form.getProperty("/accessToken");

        try {
            dlg?.setBusy?.(true);               // optional: spinner on the dialog
            if (hasToken) {
                await this._autoLogout();         // <-- call your logout method here
            } else {
                this._cancelAutoLogout?.();       // clean any timers if you set them
            }
            this._createQyrusDialog?.close();
        } catch (e) {
            // Don’t block closing on an error
            console.error("Logout error:", e);
            MessageToast.show("Logout failed, closing the dialog.");
        } finally {
            dlg?.setBusy?.(false);
            dlg?.close();
        }
    }

    public onExit(): void {
        this._createQyrusDialog?.destroy();
        this._removeObserver();       // disconnect MutationObserver
        this._cancelAutoLogout();     // clear any pending timers

    }
    private async _importTestSteps(): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;

        // --- config (proxy first, then gatewayBase)
        const comp: any = this.getOwnerComponent();
        const cfg = comp?.getManifestEntry?.("/sap.ui5/config") || {};
        const proxyBase: string = (cfg.proxyBase || "").trim();                 // e.g. "/qyrus"
        const gatewayBase: string = (cfg.gatewayBase || "https://gateway.qyrus.com").replace(/\/+$/, "");
        const base: string = (proxyBase || gatewayBase).replace(/\/+$/, "");
        const url = `${base}/webautomation-repo/v1/api/import-test-script`;

        // --- tokens/ids
        const gatewayToken: string = cfg.gatewayToken || "";
        const accessToken: string = String(form.getProperty("/accessToken") || "");
        const teamId: string = String(form.getProperty("/teams/selectedId") || "");       // UUID
        const projectUUID: string = String(form.getProperty("/projects/selectedId") || "");    // UUID
        const scriptUUID: string = String(
            form.getProperty("/createdScriptUUID") ||
            form.getProperty("/createScriptResponse/uuid") ||
            form.getProperty("/createTest/uuid") || ""         // fallback
        );

        // --- steps JSON (already produced by onConvertOpa5 -> /outJson)
        const outJsonStr = String(form.getProperty("/outJson") || "").trim();
        let stepsObj: any = null;
        try { stepsObj = outJsonStr ? JSON.parse(outJsonStr) : null; } catch { stepsObj = null; }

        // --- sanity checks
        const missing: string[] = [];
        if (!gatewayToken) missing.push("gatewayToken");
        if (!accessToken) missing.push("accessToken");
        if (!teamId) missing.push("teamId");
        if (!projectUUID) missing.push("projectUUID");
        if (!scriptUUID) missing.push("scriptUUID (create script first)");
        if (!stepsObj) missing.push("steps JSON (/outJson)");
        if (missing.length) {
            form.setProperty("/import/error", `Missing: ${missing.join(", ")}`);
            MessageToast.show(`Import failed: missing ${missing.join(", ")}`);
            return;
        }

        // --- headers (do NOT set Content-Type when using FormData)
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${gatewayToken}`,
            "Custom": `Bearer ${accessToken}`,
            "Team-Id": teamId
        };

        // --- form-data + also pass params on query string (safe for this gateway)
        const fd = new FormData();
        const blob = new Blob([JSON.stringify(stepsObj)], { type: "application/json" });
        fd.append("file", blob, "teststeps.json");
        // Some gateways accept these in body too; include for compatibility.
        fd.append("scriptUUID", scriptUUID);
        fd.append("projectUUID", projectUUID);

        const params = new URLSearchParams({ scriptUUID, projectUUID });

        // --- reset state in model
        form.setProperty("/import/error", "");
        form.setProperty("/import/result", null);

        // --- call
        let res: Response; let text = "";
        try {
            res = await fetch(`${url}?${params.toString()}`, {
                method: "POST",
                headers,
                body: fd,
                credentials: "omit"
            });
            text = await res.text();
        } catch (e) {
            form.setProperty("/import/error", String(e));
            MessageToast.show("Import steps failed (network).");
            return;
        }

        // --- parse body
        let data: any;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }

        if (!res.ok) {
            form.setProperty("/import/error", text || `HTTP ${res.status}`);
            MessageToast.show(`Import steps failed (${res.status}).`);
            return;
        }

        // --- success
        form.setProperty("/import/result", data);
        MessageToast.show("Test steps imported successfully.");
    }

    public async onCreateHeaders(): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;
        // --- inputs
        let accessToken: string = String(form.getProperty("/accessToken") || "");
        let teamId: string = String(form.getProperty("/teams/selectedId") || "");
        let moduleUUID: string = String(form.getProperty("/modules/selectedId") || "");
        const testScriptName: string = String(form.getProperty("/testName") || "").trim() || "Untitled";
        const objective: string = String(form.getProperty("/testObjective") || form.getProperty("/testDescription") || "");
        const tagName: string | null = null;

        if (!objective || !moduleUUID || !accessToken || !teamId) {
            MessageToast.show("Please ensure scriptName, objective, moduleUUID, accessToken, and teamId are set.");
            return;
        }

        const cfg = this.getOwnerComponent()?.getManifestEntry("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBase || "").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "";
        console.log("GatewayBase:", gatewayBase, "GatewayToken:", gatewayToken);
        if (!gatewayBase || !gatewayToken) {
            MessageToast.show("Please configure gatewayBase and gatewayToken");
            return;
        }

        const params = new URLSearchParams({ moduleUUID });
        const url = `${gatewayBase}/webautomation-repo/v1/api/create-script?${params.toString()}`;

        const headers: Record<string, string> = {
            "Authorization": `Bearer ${gatewayToken}`,
            "Custom": `Bearer ${accessToken}`,
            "Team-Id": teamId,
            "Content-Type": "application/json"
        };


        const payload = {
            testScriptName: testScriptName,
            objective: objective,
            tagName: tagName
        };

        try {
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(payload)
            });

            const text = await response.text();
            let data: any;
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                data = { _raw: text };
            }

            if (!response.ok) {
                throw new Error(`Error ${response.status}: ${text}`);
            }

            const scriptUUID = data.uuid || "";
            form.setProperty("/createdScriptUUID", scriptUUID);
            form.setProperty("/createScriptResponse", data);
            MessageToast.show("Test script created successfully!");

        } catch (err: any) {
            console.error("Script creation failed:", err);
            MessageToast.show(`Failed to create test script: ${err.message}`);
        }
    }

    public async onCreateTest(): Promise<void> {
        try {
            // 1) Create script (stores /createdScriptUUID)
            await this.onCreateHeaders();

            // Guard: ensure UUID exists before importing
            const form = this.getView().getModel("qyrusForm") as JSONModel;
            const scriptUUID = form.getProperty("/createdScriptUUID");

            const jour = await JourneyStorageService.getInstance().getById(
                this.model.getProperty('/id') as string
            );
            const OPA5TEXT = JSON.parse(jour.toString() || '{}');


            const input = {
                opa5Text: OPA5TEXT,
                injectHelpers: !!form.getProperty("/injectHelpers"),
                waitEach: !!form.getProperty("/waitEach"),
                timeout: Number(form.getProperty("/timeout") ?? 0),
                poll: Number(form.getProperty("/poll") ?? 0),
                launch: Boolean(form.getProperty("/optLaunch") ?? true),
                launchUrl: String(form.getProperty("/launchUrl") ?? ""),
                waitAfterLaunch: Boolean(form.getProperty("/optWaitAfterLaunch") ?? true),
                // Login options
                login: Boolean(form.getProperty("/optLogin") ?? true),
                loginUser: String(form.getProperty("/loginUser") ?? ""),
                loginPass: String(form.getProperty("/loginPass") ?? ""),
                waitAfterLogin: Boolean(form.getProperty("/optWaitAfterLogin") ?? true),
            };

            console.log("Test function input.", input);
            const result = await Converter.convertToTestSteps(input);
            console.log("Extension Received Output: ", result);
            if(result.logs) {
                const transformedWithLogs = result.logs.map((log: any, i: number) => ({
                    stepNumber: i + 1,
                    type: log.level ?? "",
                    message: log.msg ?? "",
                }));
                const logsModel = new JSONModel(transformedWithLogs);
                this._createQyrusDialog.setModel(logsModel, "logs");
            }
            // if (!scriptUUID) {
            //     MessageToast.show("Script UUID missing after creation; import skipped.");
            //     return;
            // }

            // 2) Import the steps (uses /outJson that you set elsewhere)
            await this._importTestSteps();
        } catch (e: any) {
            MessageToast.show(String(e?.message || e));
        }
    }


    public async onConvertOpa5(): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;
        // const jour = await JourneyStorageService.getInstance().save(this.model.getData() as Journey);
        const jour = await JourneyStorageService.getInstance().getById(this.model.getProperty('/id') as string);
        // console.log("Journey for OPA5 conversion:", jour);
        const OPA5TEXT = JSON.parse(jour.toString() || '{}');
        // console.log("Parsed Object:", OPA5TEXT);
        // sunil code 
        const input = {
            opa5Text: OPA5TEXT,
            injectHelpers: !!form.getProperty("/injectHelpers"),
            waitEach: !!form.getProperty("/waitEach"),
            timeout: Number(form.getProperty("/timeout") ?? 0),
            poll: Number(form.getProperty("/poll") ?? 0),
            launch: Boolean(form.getProperty("/optLaunch") ?? true),
            launchUrl: String(form.getProperty("/launchUrl") ?? ""),
            waitAfterLaunch: Boolean(form.getProperty("/optWaitAfterLaunch") ?? true),
            // waitAfterLaunchTime: Number(form.getProperty("/waitAfterLaunch") ?? 0),
            // Login options
            login: Boolean(form.getProperty("/optLogin") ?? true),
            loginUser: String(form.getProperty("/loginUser") ?? ""),
            loginPass: String(form.getProperty("/loginPass") ?? ""),
            waitAfterLogin: Boolean(form.getProperty("/optWaitAfterLogin") ?? true),
            // waitAfterLoginTime: Number(form.getProperty("/waitAfterLogin") ?? 0),
        };

        console.log("Test function input.", input);
        const result = await Converter.convertToTestSteps(input);
        console.log("Extension Received Output: ", result);

        form.setProperty("/outJson", JSON.stringify(result.steps, null, 2));

        // end



        // 1) read inputs (from the model — no byId helpers)
        // const appUrl = "https://stg.qyrus.com"
        // const email = "apurohit@quinnox.com"
        // const pass = "Password@123"

        // production 
        const appUrl = "https://app.qyrus.com"
        const email = "krtr.qyrus@gmail.com"
        const pass = "Qyrus@1314"

        if (!appUrl || !email || !pass) {
            MessageToast.show("Please provide Launch URL, Login User, and Login Pass.");
            return;
        }

        // 2) config (prefer manifest.json: sap.ui5/config/{gatewayBase, gatewayToken, authPaths?})
        const cfg = this.getOwnerComponent()?.getManifestEntry("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBaseFallback || "").replace(/\/+$/, "");
        const gatewayBase_2: string = (cfg.gatewayBase || "").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "";
        console.log("GatewayBase:", gatewayBase, "GatewayToken:", gatewayToken);
        if (!gatewayBase || !gatewayToken) {
            MessageToast.show("Please configure gatewayBase and gatewayToken");
            return;
        }
        const authPaths: string[] = cfg.authPaths || [
            "authentication/v1/api/get-access-token"
        ];

        // 3) build login request
        const payload = { applicationUrl: appUrl, email, password: pass, isSSO: false };
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${gatewayToken}`,
            "Content-Type": "application/json"
        };

        // 4) call login (try paths in order)
        let loginData: any | null = null;
        for (const path of authPaths) {
            const url = `${gatewayBase}/${path.replace(/^\/+/, "")}`;
            try {
                const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
                const text = await res.text();
                let data: any;
                try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }

                if (!res.ok) {
                    if (res.status === 404) continue; // try next path
                    throw new Error(`HTTP ${res.status} on ${url}\n${text.slice(0, 1000)}`);
                }
                loginData = data;
                break;
            } catch (e) {
                // if not 404 we already threw; otherwise continue to next path
                continue;
            }
        }

        if (!loginData) {
            MessageToast.show("Login failed. Verify gatewayBase/gatewayToken or auth path.");
            return;
        }

        // 5) capture access token, teams, service stores into the model
        const accessToken =
            loginData?.accessToken || loginData?.access_token || loginData?.token || loginData?.jwt || loginData?.access || "";

        const teams = this._extractTeams(loginData);                 // [{id, name}]
        const serviceStores = this._extractServiceStores(loginData); // [{id, name}]

        // choose sensible defaults
        const preferredService = serviceStores.find(s => /web\s*testing/i.test(s.name)) || serviceStores[0] || null;
        const defaultTeam = teams[0] || null;

        form.setProperty("/accessToken", accessToken);
        this._scheduleAutoLogout(15);
        form.setProperty("/teams", {
            list: teams,
            selectedId: defaultTeam ? defaultTeam.id : ""
        });
        form.setProperty("/serviceStores", {
            list: serviceStores,
            selectedId: preferredService ? preferredService.id : ""
        });

        // optional: keep the full login JSON if you already bind it somewhere
        // form.setProperty("/outJson", JSON.stringify(loginData, null, 2));

        // 6) if both selections are available, load projects immediately
        const teamId = form.getProperty("/teams/selectedId") as string;
        const serviceStoreId = form.getProperty("/serviceStores/selectedId") as string;
        if (accessToken && teamId && serviceStoreId) {
            await this._loadProjects(gatewayBase_2, gatewayToken, accessToken, teamId, serviceStoreId);
        }
    }

    public async onTeamChanged(oEvent: Select$ChangeEvent): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;
        const item = oEvent.getParameter("selectedItem") as Item | null;
        const selectedId = item?.getKey ? item.getKey() : "";
        form.setProperty("/teams/selectedId", selectedId);
        await this._tryLoadProjectsFromModel();
    }

    public async onServiceStoreChanged(oEvent: Select$ChangeEvent): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;
        const item = oEvent.getParameter("selectedItem") as Item | null;
        const selectedId = item?.getKey ? item.getKey() : "";
        form.setProperty("/serviceStores/selectedId", selectedId);
        await this._tryLoadProjectsFromModel();
    }
    public async onProjectChanged(oEvent: Select$ChangeEvent): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;
        const item = oEvent.getParameter("selectedItem") as Item | null;
        const projectId = item?.getKey ? item.getKey() : "";
        form.setProperty("/projects/selectedId", projectId);
        await this._tryLoadModulesFromModel();
    }


    // helper: load projects if we have everything needed in the model
    private async _tryLoadProjectsFromModel(): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;
        const cfg = this.getOwnerComponent()?.getManifestEntry("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBase || "").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "";
        if (!gatewayBase || !gatewayToken) {
            MessageToast.show("Please configure gatewayBase and gatewayToken");
            return;
        }

        const accessToken = String(form.getProperty("/accessToken") || "");
        const teamId = String(form.getProperty("/teams/selectedId") || "");
        const serviceStoreId = String(form.getProperty("/serviceStores/selectedId") || "");

        if (accessToken && teamId && serviceStoreId) {
            await this._loadProjects(gatewayBase, gatewayToken, accessToken, teamId, serviceStoreId);
        }
    }
    // call the GET Projects API and fill projects dropdown
    private async _loadProjects(
        gatewayBase: string,
        gatewayToken: string,
        accessToken: string,
        teamId: string,
        serviceStoreId: string
    ): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;

        // ---- preflight checks (keep lightweight)
        const missing: string[] = [];
        if (!gatewayBase) missing.push("gatewayBase");
        if (!gatewayToken) missing.push("gatewayToken");
        if (!accessToken) missing.push("accessToken");
        if (!teamId) missing.push("teamId");
        if (!serviceStoreId) missing.push("serviceStoreId");
        if (missing.length) {
            form.setProperty("/projects/list", []);
            form.setProperty("/projects/error", `Missing: ${missing.join(", ")}`);
            MessageToast.show(`Projects load failed: missing ${missing.join(", ")}`);
            return;
        }

        // helpful sanity (no hard fail): warn if teamId doesn't look like a UUID
        const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId);
        if (!looksUuid) {
            form.setProperty("/projects/warning", "teamId does not look like a UUID (double-check selection).");
        }

        const cfg: any = (this.getOwnerComponent() as any)?.getManifestEntry?.("/sap.ui5/config") || {};
        const proxyBase: string = (cfg.proxyBase || "").trim();
        const base = (proxyBase || gatewayBase).replace(/\/+$/, "");
        const url = `${base}/webautomation-repo/v1/api/projects-by-team-and-servicestore`;

        // ---- headers (as-is per your requirement)
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${gatewayToken}`,
            "Custom": `Bearer ${accessToken}`,
            "Team-Id": teamId
        };

        // ---- query params
        const params = new URLSearchParams({
            teamId,
            serviceStoreId,
            page: "0",
            size: "30",
            searchTerm: ""
        });

        // ---- store sanitized debug info (no full tokens)
        form.setProperty("/debug/lastProjectsRequest", {
            url: `${url}?${params.toString()}`,
            headers: {
                Authorization: `Bearer ${gatewayToken.slice(0, 8)}…`,
                Custom: `Bearer ${accessToken.slice(0, 8)}…`,
                "Team-Id": teamId
            }
        });

        // ---- timeout using model's /timeout (seconds), default 30s
        // const timeoutMs = Math.max(5, Number(form.getProperty("/timeout") || 30)) * 1000;
        // const controller = new AbortController();
        // const timer = setTimeout(() => controller.abort(), timeoutMs);

        let res: Response;
        let text = "";
        try {
            res = await fetch(`${url}?${params.toString()}`, { method: "GET", headers});
            text = await res.text();
        } catch (err) {
            form.setProperty("/projects/list", []);
            form.setProperty("/projects/error", String(err));
            MessageToast.show("Network error while loading projects.");
            return;
        } 

        // ---- parse JSON / XML (e.g., WSO2 <ams:fault/>)
        let data: any = {};
        const ctype = (res.headers.get("content-type") || "").toLowerCase();
        if (ctype.includes("application/json")) {
            try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }
        } else if (ctype.includes("xml") || /^<\?xml|<ams:fault/i.test(text)) {
            const code = (text.match(/<ams:code>([^<]+)<\/ams:code>/i) || [])[1];
            const msg = (text.match(/<ams:message>([^<]+)<\/ams:message>/i) || [])[1];
            const desc = (text.match(/<ams:description>([^<]+)<\/ams:description>/i) || [])[1];
            data = { fault: { code, message: msg, description: desc }, _raw: text };
        } else {
            data = { _raw: text };
        }

        if (!res.ok) {
            form.setProperty("/projects/list", []);
            // Prefer structured fault description if present
            const errText = data?.fault?.description || data?.fault?.message || text || `HTTP ${res.status}`;
            form.setProperty("/projects/error", errText);
            MessageToast.show(`Projects load failed (${res.status}).`);
            return;
        }

        // ---- success: normalize & fill dropdown
        const content: any[] = Array.isArray(data?.content) ? data.content : [];
        const projects = content
            .map(p => ({ id: String(p?.uuid || ""), name: String(p?.projectName || "") }))
            .filter(p => p.id && p.name);

        if (projects.length === 0) {
            form.setProperty("/projects", { list: [], selectedId: "" });
            form.setProperty("/projects/empty", true);
            MessageToast.show("No projects found for the selected Team & Service Store.");
            return;
        }

        form.setProperty("/projects", {
            list: projects,
            selectedId: projects[0].id
        });
        form.setProperty("/projects/empty", false);
    }


    // ---- extractors for variable login payload shapes ----

    private _extractTeams(loginData: any): Array<{ id: string; name: string }> {
        const out: Array<{ id: string; name: string }> = [];

        const add = (id?: any, name?: any) => {
            const i = String(id || "").trim();
            const n = String(name || "").trim();
            if (i && n && !out.some(x => x.id === i)) out.push({ id: i, name: n });
        };

        const candidates: any[] = []
            .concat(loginData?.teams || [])
            .concat(loginData?.teamList || [])
            .concat(loginData?.userTeams || [])
            .concat(loginData?.teamIds || []);

        candidates.forEach((t: any) => {
            if (typeof t === "string") {
                // if server only returns a string, treat it as the UUID (best effort)
                add(t, t);
            } else if (t && typeof t === "object") {
                // ✅ Prefer UUID for the id we circulate to the Projects API
                const uuid = t.uuid || t.teamUUID || t.teamId || t.id;
                const name = t.name || t.teamName || t.displayName || uuid;
                add(uuid, name);
            }
        });

        // Sometimes team info appears under licenses — prefer UUID here as well
        const lic = Array.isArray(loginData?.licenses) ? loginData.licenses : [];
        lic.forEach((l: any) => {
            const uuid = l?.teamUUID || l?.teamId;
            const name = l?.teamName || uuid;
            add(uuid, name);
        });

        return out;
    }


    private _extractServiceStores(loginData: any): Array<{ id: string; name: string }> {
        const out: Array<{ id: string; name: string }> = [];
        const add = (id?: any, name?: any) => {
            const i = String(id || "").trim();
            const n = String(name || "").trim();
            if (i && n && !out.some(x => x.id === i)) out.push({ id: i, name: n });
        };

        const lic = Array.isArray(loginData?.licenses) ? loginData.licenses : [];
        lic.forEach((l: any) => {
            const ss = l?.serviceStore || l?.service || {};
            add(ss?.uuid || ss?.id, ss?.serviceName || ss?.name || "");
        });

        return out;
    }
    private async _tryLoadModulesFromModel(): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;

        const cfg = this.getOwnerComponent()?.getManifestEntry("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBase || "").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "";
        if (!gatewayBase || !gatewayToken) {
            MessageToast.show("Please configure gatewayBase and gatewayToken");
            return;
        }
        const proxyBase: string = (cfg.proxyBase || "").trim();
        const base = (proxyBase || gatewayBase).replace(/\/+$/, "");

        const accessToken = String(form.getProperty("/accessToken") || "");
        const teamId = String(form.getProperty("/teams/selectedId") || "");
        const projectId = String(form.getProperty("/projects/selectedId") || "");

        if (!projectId) {
            MessageToast.show("Please select a project first.");
            return;
        }

        await this._loadModules(base, gatewayToken, accessToken, teamId, projectId);
    }

    // GET modules by project and fill modules dropdown
    private async _loadModules(
        base: string,
        gatewayToken: string,
        accessToken: string,
        teamId: string,
        projectId: string
    ): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;

        // minimal preflight
        const missing: string[] = [];
        if (!gatewayToken) missing.push("gatewayToken");
        if (!accessToken) missing.push("accessToken");
        if (!teamId) missing.push("teamId");
        if (!projectId) missing.push("projectId");
        if (missing.length) {
            form.setProperty("/modules/list", []);
            form.setProperty("/modules/error", `Missing: ${missing.join(", ")}`);
            MessageToast.show(`Modules load failed: missing ${missing.join(", ")}`);
            return;
        }

        const url = `${base}/webautomation-repo/v1/api/module-repositories`;
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${gatewayToken}`,
            "Custom": `Bearer ${accessToken}`,
            "Team-Id": teamId
        };
        const params = new URLSearchParams({
            projectId,
            page: "0",
            size: "100",
            searchTerm: ""
        });

        // optional timeout using your model's /timeout
        // const timeoutMs = Math.max(5, Number(form.getProperty("/timeout") || 30)) * 1000;
        // const controller = new AbortController();
        // const timer = setTimeout(() => controller.abort(), timeoutMs);

        let res: Response; let text = "";
        try {
            res = await fetch(`${url}?${params.toString()}`, { method: "GET", headers});
            text = await res.text();
        } catch (err) {
            form.setProperty("/modules/list", []);
            form.setProperty("/modules/error", String(err));
            MessageToast.show("Network error while loading modules.");
            return;
        } 

        let data: any;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }

        if (!res.ok) {
            form.setProperty("/modules/list", []);
            form.setProperty("/modules/error", text || `HTTP ${res.status}`);
            MessageToast.show(`Modules load failed (${res.status}).`);
            return;
        }

        const content: any[] = Array.isArray(data?.content) ? data.content : [];
        const modules = content
            .map(m => ({ id: String(m?.uuid || ""), name: String(m?.moduleName || "") }))
            .filter(m => m.id && m.name);

        form.setProperty("/modules", {
            list: modules,
            selectedId: modules[0]?.id || ""
        });
    }

    private async _autoLogout(): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;
        const cfg = this.getOwnerComponent()?.getManifestEntry("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBaseFallback || "").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "";
        console.log("GatewayBase:", gatewayBase, "GatewayToken:", gatewayToken);
        if (!gatewayBase || !gatewayToken) {
            MessageToast.show("Please configure gatewayBase and gatewayToken");
            return;
        }
        let accessToken: string = String(form.getProperty("/accessToken") || "");
        const appUrl = "https://app.qyrus.com"

        const logoutPaths: string[] = cfg.logoutPaths || [
            "authentication/v1/api/logout",
        ];

        // Build headers/payload (same as doc)
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${gatewayToken}`,
            "Content-Type": "application/json"
        };
        const payload = {
            accessToken,          // from your model earlier in _autoLogout()
            url: appUrl   // from your model earlier in _autoLogout()
        };

        let logoutData: any | null = null;
        let lastErr: any = null;

        for (const path of logoutPaths) {
            const url = `${gatewayBase}/${path.replace(/^\/+/, "")}`;
            try {
                const res = await fetch(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                });
                const text = await res.text();

                let data: any;
                try { data = text ? JSON.parse(text) : {}; } catch { data = { _raw: text }; }

                if (!res.ok) {
                    if (res.status === 404) {        // try the next candidate path
                        lastErr = `404 on ${url}`;
                        continue;
                    }
                    MessageToast.show(`Logout failed (${res.status}).`);
                    throw new Error(`HTTP ${res.status} on ${url}\n${text.slice(0, 1000)}`);
                    
                }

                // success
                logoutData = data;
                MessageToast.show("Logged out Successfully.");
                break;
            } catch (e) {
                lastErr = e;
                continue;
            }
        }

        if (!logoutData) {
            throw new Error(`Logout failed on all candidate paths. ${String(lastErr || "")}`);
        }

        // always clear the timer after attempting logout
        this._cancelAutoLogout();
    }

    /** Schedule auto logout after N minutes (default 15) */
    private _scheduleAutoLogout(minutes = 15): void {
        this._cancelAutoLogout();
        const ms = Math.max(1, minutes) * 60 * 1000;
        this._logoutTimer = setTimeout(() => {
            this._autoLogout().catch(() => {/* swallow—debug is in _request() */ });
        }, ms);
    }

    /** Cancel any pending auto logout (e.g., on manual logout, dialog close) */
    private _cancelAutoLogout(): void {
        if (this._logoutTimer) {
            clearTimeout(this._logoutTimer);
            this._logoutTimer = null;
        }
    }













    // end 
    async onExport() {
        const unsafed = (this.getModel('journeyControl') as JSONModel).getProperty('/unsafed') as boolean;

        if (unsafed) {
            this._openUnsafedDialog({
                success: async () => {
                    await this._export();
                    BusyIndicator.hide();
                },
                error: () => {
                    this.byId('saveBtn').focus();
                    BusyIndicator.hide();
                }
            })
        } else {
            await this._export();
            BusyIndicator.hide();
        }
    }

    async onSave() {
        await JourneyStorageService.getInstance().save(this.model.getData() as Journey);
        (this.getModel('journeyControl') as JSONModel).setProperty('/unsafed', false);
        MessageToast.show('Journey saved!');
    }

    async frameworkChange($event: Event) {
        const button: Button = $event.getSource();
        if (!this._frameworkMenu) {
            this._frameworkMenu = await Fragment.load({
                id: this.getView().getId(),
                name: "com.ui5.journeyrecorder.fragment.TestFrameworkMenu",
                controller: this
            }) as Menu;
            this.getView().addDependent(this._frameworkMenu);
        }
        this._frameworkMenu.openBy(button, false);
    }

    onFrameworkChange() {
        const journey = (this.getModel('journey') as JSONModel).getData() as Journey;
        this._generateCode(journey);
    }

    onStyleChange() {
        const journey = (this.getModel('journey') as JSONModel).getData() as Journey;
        this._generateCode(journey);
    }

    onSelectCodeTab(oEvent: Event) {
        const codeId = oEvent.getParameter("selectedKey" as never) as string;
        const modelData = (this.getModel('journeyControl') as JSONModel).getData() as Record<string, unknown>;
        const generatedCode = modelData['codes'] as CodePage[];
        const page = generatedCode.find((cp: CodePage) => cp.title === codeId);
        (this.getModel('journeyControl') as JSONModel).setProperty('/activeCode', page.code);
    }

    async onCopyCode() {
        const pageTitle = (this.byId("codePreviewTabs") as IconTabBar).getSelectedKey();
        const codeContent = ((this.getModel("journeyControl") as JSONModel).getData() as { codes: Record<string, unknown>[] }).codes.find(c => c.title === pageTitle).code as string;
        await navigator.clipboard.writeText(codeContent);
        MessageToast.show("Code copied");
    }

    async onCodeDownload() {
        const modelData = (this.getModel('journeyControl') as JSONModel).getData() as Record<string, unknown>;
        const generatedCode = modelData['codes'] as CodePage[];
        const journey = (this.getModel('journey') as JSONModel).getData() as Partial<Journey>;

        const files = [];
        const framework = modelData.framework;
        const style = modelData.style;

        const sTestFolder = framework === TestFrameworks.OPA5 ? 'integration' : 'e2e';
        const journeyPage = generatedCode.find((p) => p.type === 'journey');
        const viewPages = generatedCode.filter((p) => p.type === 'page');

        const jourName = `${Utils.replaceUnsupportedFileSigns(journeyPage?.title || '', '_')}.${(style === CodeStyles.TypeScript ? 'ts' : 'js')}`;
        files.push({ name: `${sTestFolder}/${jourName}`, input: (journeyPage?.code as string || '') });

        viewPages.forEach((p) => {
            const name = `${Utils.replaceUnsupportedFileSigns(p.title, '_')}.${(style === CodeStyles.TypeScript ? 'ts' : 'js')}`;
            files.push({ name: `${sTestFolder}/pages/${name}`, input: (p.code as string || '') });
        });
        // get the ZIP stream in a Blob
        const blob = await downloadZip(files).blob()

        // make and click a temporary link to download the Blob
        const link = document.createElement("a")
        link.href = URL.createObjectURL(blob)
        link.download = `${Utils.replaceUnsupportedFileSigns(journey.name, '_')}.zip`
        link.click()
        link.remove()
    }

    async onStopRecording() {
        this._recordingDialog.close();
        BusyIndicator.show();
        const ui5Version = await this._requestUI5Version();
        const data = this.model.getData() as Partial<Journey>;
        data.ui5Version = ui5Version;
        if (data.steps && data.steps.length > 0) {
            const journey = JourneyStorageService.createJourneyFromRecording(data);
            ChromeExtensionService.getInstance().unregisterRecordingWebsocket(
                // eslint-disable-next-line @typescript-eslint/unbound-method
                this._onStepRecord,
                this
            );
            await ChromeExtensionService.getInstance().disableRecording();
            BusyIndicator.hide();
            this.model.setData(journey);
            (this.getModel('journeyControl') as JSONModel).setProperty('/unsafed', true);
            this._generateCode(journey);
        } else {
            await ChromeExtensionService.getInstance().disableRecording();
            BusyIndicator.hide();
            this.getRouter().navTo("main");
        }
    }

    private _generateCode(journey: Journey) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const framework = (this.getModel('journeyControl') as JSONModel).getProperty('/framework') as TestFrameworks;
        const style = (this.getModel('journeyControl') as JSONModel).getProperty('/style') as CodeStyles;
        CodeGenerationService.generateJourneyCode(journey, { framework, style }).then((codes) => {
            (this.getModel('journeyControl') as JSONModel).setProperty('/codes', codes);
        });
    }

    private async _export() {
        const jour = await JourneyStorageService.getInstance().getById(this.model.getProperty('/id') as string);
        // console.log('Exporting journey', jour);
        const link = document.createElement('a');
        const blob = new Blob([jour.toString() || ''], {
            type: 'octet/stream'
        });
        const name = Utils.replaceUnsupportedFileSigns((this.model.getProperty('/name') as string) || 'blub', '_') + '.json';
        link.setAttribute('href', window.URL.createObjectURL(blob));
        link.setAttribute('download', name);
        link.click();
        link.remove();
    }

    private _setToUnsafed() {
        (this.getModel('journeyControl') as JSONModel).setProperty('/unsafed', true);
    }

    private async _loadJourney(oEvent: Event) {
        await this._setupJourneyControlModel();
        const oArgs: { id: string } = oEvent.getParameter("arguments" as never);
        const journey = await JourneyStorageService.getInstance().getById(oArgs.id);
        this.model = new JSONModel(journey);
        this.setModel(this.model, 'journey');
        this.model.attachPropertyChange(() => {
            this._setToUnsafed();
            this._generateCode(this.model.getData() as Journey);
        });
        this._generateCode(journey);
    }

    private async _recordJourney(oEvent: Event) {
        BusyIndicator.show();
        await this._setupJourneyControlModel();
        const { tabId } = oEvent.getParameter('arguments' as never) as { tabId: number };
        const tab = await ChromeExtensionService.getTabInfoById(tabId);
        this.model = new JSONModel({ name: tab.title });
        this.setModel(this.model, 'journey');

        let settings = (this.getModel('settings') as JSONModel)?.getData() as AppSettings;
        if (!settings) {
            settings = await SettingsStorageService.getSettings();
        }
        let reload = settings.reloadPageDefault;
        const connectFn = () => {
            BusyIndicator.show();
            this._approveConnectDialog.close();
            this.setConnecting();
            ChromeExtensionService.getInstance().setCurrentTab(tab);
            ChromeExtensionService.getInstance().connectToCurrentTab(reload).then(async () => {
                ChromeExtensionService.getInstance().registerRecordingWebsocket(
                    // eslint-disable-next-line @typescript-eslint/unbound-method
                    this._onStepRecord,
                    this
                )
                this.setConnected();
                void ChromeExtensionService.getInstance().focusTab(tab);
                BusyIndicator.hide();
                MessageToast.show('Connected');
                try {
                    await this._openRecordingDialog();
                } catch (oError) {

                }
            }).catch(() => {
                BusyIndicator.hide();
            });
        };


        if (!this._approveConnectDialog) {
            const dialogContent = new VBox({
                alignItems: FlexAlignItems.Start,
                justifyContent: FlexAlignContent.Start
            });
            dialogContent.addItem(
                new Text({ text: `Go to "${tab.title}" tab and inject Qyrus scripts?` })
            );
            const chkBox =
                new CheckBox({ text: 'Refresh Page', selected: reload });
            chkBox.attachSelect((p1: CheckBox$SelectEvent) => {
                reload = p1.getParameter("selected");
            })
            dialogContent.addItem(
                chkBox
            );
            this._approveConnectDialog = new Dialog({
                type: DialogType.Message,
                title: 'Go to',
                content: dialogContent,
                beginButton: new Button({
                    text: "Go",
                    press: connectFn
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: () => {
                        this._approveConnectDialog.close()
                    }
                })
            });
        } else {
            const dialogContent = this._approveConnectDialog.getAggregation('content') as Control[];
            ((dialogContent[0] as VBox).getItems()[0] as Text).setText(`Go to "${tab.title}" tab and inject Qyrus scripts?`);
            this._approveConnectDialog.getBeginButton().attachPress(connectFn);
        }
        BusyIndicator.hide();
        this._approveConnectDialog.open();
    }

    private async _setupJourneyControlModel() {
        this.setModel(new JSONModel({ titleVisible: true, titleInputVisible: false, replayEnabled: false }), 'journeyControl');
        const settings = (await SettingsStorageService.getSettings());
        (this.getModel('journeyControl') as JSONModel).setProperty('/framework', settings.framework);
        (this.getModel('journeyControl') as JSONModel).setProperty('/style', settings.style);
    }

    private async _openRecordingDialog() {
        if (!this._recordingDialog) {
            this._recordingDialog = await this.loadFragment({
                name: "com.ui5.journeyrecorder.fragment.RecordingDialog"
            }) as Dialog;
            this.getView().addDependent(this._recordingDialog);
        }
        (this._recordingDialog).open();
    }

    private async _openReplayDialog() {
        if (!this._replayDialog) {
            this._replayDialog = await this.loadFragment({
                name: "com.ui5.journeyrecorder.fragment.ReplayStartDialog"
            }) as Dialog;
            this.getView().addDependent(this._replayDialog);
        }
        (this._replayDialog).open();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private _onStepRecord(_1: string, _2: string, recordData: object) {
        const data = this.model.getData() as { name: string; steps?: Step[] };
        const newStep = Step.recordEventToStep(recordData as RecordEvent);
        if (!data.steps) {
            data.steps = [];
        }
        data.steps.push(newStep);
        this.model.setData(data);
        console.log('wrote record step');
    }

    private async _requestUI5Version() {
        const req = new RequestBuilder()
            .setMethod(RequestMethod.GET)
            .setUrl('/pageInfo/version')
            .build();
        const version = await ChromeExtensionService.getInstance().sendSyncMessage(req) as { message: string };
        return version.message;
    }
}