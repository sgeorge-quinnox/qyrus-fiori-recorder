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
declare const chrome: any;


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

    async onInit() {
        // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/unbound-method
        this.getRouter().getRoute("journey").attachMatched(this._loadJourney, this);
        // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/unbound-method
        this.getRouter().getRoute("recording").attachMatched(this._recordJourney, this);
        // Dialog form model (defaults)
        const qyrusForm = new JSONModel({
            injectHelpers: false,
            waitEach: false,
            launchUrl: this.getView().getModel("journey")?.getProperty("/startUrl") || "",
            timeout: 30,
            poll: 1000,
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
            loginUser: "krtr.qyrus@gmail.com",
            loginPass: "Qyrus@1314",

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

    public async onCreateQyrus(): Promise<void> {
        const view = this.getView();
        if (!this._createQyrusDialog) {
            this._createQyrusDialog = await Fragment.load({
                id: view.getId(),
                name: "com.ui5.journeyrecorder.fragment.CreateQyrusDialog",
                controller: this
            }) as Dialog;
            view.addDependent(this._createQyrusDialog);
        }
        this._createQyrusDialog.open();
    }

    public onCancelCreateQyrus(): void {
        this._createQyrusDialog?.close();
    }

    public onExit(): void {
        this._createQyrusDialog?.destroy();
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

        const comp: any = this.getOwnerComponent();
        const cfg = comp?.getManifestEntry?.("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBase || "https://stg-gateway.qyrus.com:8243/").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "90540897-748a-3ef2-b3a3-c6f8f42022da";

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


    public async onCreateHeadersTest(): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;

        // --- config
        const comp: any = this.getOwnerComponent();
        const cfg = comp?.getManifestEntry?.("/sap.ui5/config") || {};
        const proxyBase: string = (cfg.proxyBase || "").trim();   // e.g. "/qyrus"
        const gatewayBase: string = (cfg.gatewayBase || "https://stg-gateway.qyrus.com:8243/").replace(/\/+$/, "");

        // Prefer proxy when configured; warn if running as chrome-extension (CORS likely)
        const isExt = typeof window !== "undefined" && window.location?.protocol === "chrome-extension:";
        if (isExt && proxyBase) {
            // Proxy won’t exist in extension context; you’re calling the gateway directly → 403 likely on POST.
            form.setProperty("/createTest/warning",
                "Running from chrome-extension origin. ProxyBase cannot be used; CORS/403 on POST may occur. " +
                "Run via http://localhost:8080 to use the /qyrus proxy.");
        }

        const base: string = (proxyBase && !isExt ? proxyBase : gatewayBase).replace(/\/+$/, "");
        const url = `${base}/webautomation-repo/v1/api/create-script`;

        // --- inputs
        let gatewayToken: string = cfg.gatewayToken || "90540897-748a-3ef2-b3a3-c6f8f42022da";
        let accessToken: string = String(form.getProperty("/accessToken") || "");
        let teamId: string = String(form.getProperty("/teams/selectedId") || "");
        let moduleUUID: string = String(form.getProperty("/modules/selectedId") || "");
        const testScriptName: string = String(form.getProperty("/testName") || "").trim() || "Untitled";
        const objective: string = String(form.getProperty("/testObjective") || form.getProperty("/testDescription") || "");
        const tagName: string | null = null;

        // scrub hidden chars / CRLF (mirrors your Postman pre-request script)
        const scrub = (s: string) =>
            s.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/[\r\n]+/g, "").trim();
        gatewayToken = scrub(gatewayToken);
        accessToken = scrub(accessToken);
        teamId = scrub(teamId);
        moduleUUID = scrub(moduleUUID);

        // --- preflight
        const missing: string[] = [];
        if (!gatewayToken) missing.push("gatewayToken");
        if (!accessToken) missing.push("accessToken");
        if (!teamId) missing.push("teamId");
        if (!moduleUUID) missing.push("moduleUUID (select a Module)");
        if (missing.length) {
            form.setProperty("/createTest/error", `Missing: ${missing.join(", ")}`);
            MessageToast.show(`Create test failed: missing ${missing.join(", ")}`);
            return;
        }

        // --- headers (same as projects)
        const headers: Record<string, string> = {
            "Authorization": `Bearer ${gatewayToken}`,
            "Custom": `Bearer ${accessToken}`,
            "Team-Id": teamId,
            "Content-Type": "application/json"
        };

        // --- params & body
        const params = new URLSearchParams({ moduleUUID });
        const body = JSON.stringify({ testScriptName, objective, tagName });

        // --- timeout
        const timeoutMs = Math.max(5, Number(form.getProperty("/timeout") || 30)) * 1000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        // --- reset & debug
        form.setProperty("/createTest/error", "");
        form.setProperty("/createTest/result", null);
        form.setProperty("/createTest/uuid", "");
        form.setProperty("/debug/lastCreateRequest", {
            url: `${url}?${params.toString()}`,
            headers: {
                Authorization: `Bearer ${gatewayToken.slice(0, 8)}…`,
                Custom: `Bearer ${accessToken.slice(0, 8)}…`,
                "Team-Id": teamId,
                "Content-Type": "application/json"
            },
            body: { testScriptName, objective, tagName }
        });

        // --- fetch (explicitly omit credentials to avoid cross-site cookies noise)
        let res: Response; let text = "";
        // const res = await fetch(url, { method: "POST", headers, body });
        try {
            res = await fetch(`${url}?${params.toString()}`, {
                method: "POST",
                headers,
                body
            });
            text = await res.text();
        } catch (err) {
            clearTimeout(timer);
            form.setProperty("/createTest/error", String(err));
            form.setProperty("/debug/lastCreateResponse", { status: "NETWORK", text: String(err) });
            MessageToast.show("Network error while creating test.");
            return;
        } finally {
            clearTimeout(timer);
        }

        // --- parse: try JSON first (even if content-type is octet-stream), then WSO2 XML, else raw
        let data: any = {};
        let parsedJson = false;
        try {
            data = text ? JSON.parse(text) : {};
            parsedJson = true;
        } catch { /* not JSON */ }

        if (!parsedJson) {
            if (/^<\?xml|<ams:fault/i.test(text)) {
                const code = (text.match(/<ams:code>([^<]+)<\/ams:code>/i) || [])[1];
                const msg = (text.match(/<ams:message>([^<]+)<\/ams:message>/i) || [])[1];
                const desc = (text.match(/<ams:description>([^<]+)<\/ams:description>/i) || [])[1];
                data = { fault: { code, message: msg, description: desc }, _raw: text };
            } else {
                data = { _raw: text };
            }
        }

        // persist response snapshot for debugging (status, headers summary, raw)
        form.setProperty("/debug/lastCreateResponse", {
            status: res.status,
            ok: res.ok,
            headers: {
                "content-type": res.headers.get("content-type") || "",
                "access-control-allow-origin": res.headers.get("access-control-allow-origin") || ""
            },
            raw: text.slice(0, 2000)
        });

        // --- error handling (401 hint for expired token)
        if (!res.ok) {
            let hint = "";
            if (res.status === 401) {
                try {
                    const payload = JSON.parse(atob(accessToken.split(".")[1] || ""));
                    if (payload?.exp && new Date(payload.exp * 1000) < new Date()) {
                        hint = " (access token expired)";
                    }
                } catch { }
            }
            const errText = data?.fault?.description || data?.fault?.message || text || `HTTP ${res.status}`;
            form.setProperty("/createTest/error", errText + hint);
            // also surface something in outJson so you see it immediately
            form.setProperty("/outJson", JSON.stringify({ error: errText, status: res.status }, null, 2));
            MessageToast.show(`Create test failed (${res.status}).`);
            return;
        }

        // --- success
        const scriptUUID = String(data?.uuid || "");
        form.setProperty("/createTest/result", data);
        form.setProperty("/createTest/uuid", scriptUUID);
        form.setProperty("/outJson", JSON.stringify(data, null, 2));
        MessageToast.show(`Test created: ${testScriptName}${scriptUUID ? " (" + scriptUUID + ")" : ""}`);
    }


    public onCreateTest(): void {
        MessageToast.show("Create Test clicked (demo)");
    }

    public async onConvertOpa5(): Promise<void> {
        const form = this.getView().getModel("qyrusForm") as JSONModel;
        // sunil code 
        
        // const OPA5TEXT = String(form.getProperty("/opa5Input") || "");
        const OPA5TEXT = {
            "id": "ce25b674-a23e-4b59-a4a7-2b22f5714438",
            "created": 1756462395601,
            "edited": 1756462395601,
            "steps": [
                {
                "id": "679566ac-9ee8-4e3d-adfe-254c2a3bd631",
                "actionType": "clicked",
                "actionLocation": "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage&/?sap-iapp-state--history=TASJZZCY7UQNR4G3OI2SN3ZA6TBHRKSN4WE7QT4N1&sap-iapp-state=TASGTOTIIKPN5T3PY6D2NSRTCI4V752D3J47XYJML",
                "control": {
                    "controlId": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ListReport.view.ListReport::C_PurchaseOrderTP--addEntry",
                    "use": true
                    },
                    "type": "sap.m.Button",
                    "properties": [
                    {
                        "name": "accessibleRole",
                        "value": "Default",
                        "use": false
                    },
                    {
                        "name": "activeIcon",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "ariaDescribedBy",
                        "value": [
                        "__text85"
                        ],
                        "use": false
                    },
                    {
                        "name": "ariaHasPopup",
                        "value": "None",
                        "use": false
                    },
                    {
                        "name": "ariaLabelledBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "blocked",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busy",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorDelay",
                        "value": 1000,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorSize",
                        "value": "Medium",
                        "use": false
                    },
                    {
                        "name": "dependents",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dragDropConfig",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "enabled",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "fieldGroupIds",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "icon",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "iconDensityAware",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "iconFirst",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "id",
                        "value": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ListReport.view.ListReport::C_PurchaseOrderTP--addEntry",
                        "use": false
                    },
                    {
                        "name": "text",
                        "value": "Create",
                        "use": false
                    },
                    {
                        "name": "textDirection",
                        "value": "Inherit",
                        "use": false
                    },
                    {
                        "name": "type",
                        "value": "Transparent",
                        "use": false
                    },
                    {
                        "name": "visible",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "width",
                        "value": "",
                        "use": false
                    }
                    ],
                    "i18nTexts": [
                    {
                        "propertyName": "text",
                        "propertyPath": "CREATE_OBJECT",
                        "bindingValue": "Create",
                        "use": false
                    }
                    ],
                    "bindings": [
                    {
                        "contextPath": "/ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ListReport.view.ListReport::C_PurchaseOrderTP--listReport",
                        "modelName": "$cmd",
                        "use": false
                    }
                    ]
                },
                "styleClasses": [
                    "sapMBarChild",
                    "injectClass"
                ],
                "recordReplaySelector": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ListReport.view.ListReport::C_PurchaseOrderTP--addEntry",
                    "text": "Create"
                },
                "viewInfos": {
                    "absoluteViewName": "sap.suite.ui.generic.template.ListReport.view.ListReport",
                    "relativeViewName": "ListReport"
                }
                },
                {
                "id": "fed037e7-a498-4d56-ad2f-427379d801e9",
                "actionType": "keypress",
                "actionLocation": "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage&/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)/?sap-iapp-state--history=TASJZZCY7UQNR4G3OI2SN3ZA6TBHRKSN4WE7QT4N1",
                "control": {
                    "controlId": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet1::DocumentCurrency::Field-input",
                    "use": true
                    },
                    "type": "sap.m.Input",
                    "properties": [
                    {
                        "name": "id",
                        "value": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet1::DocumentCurrency::Field-input",
                        "use": false
                    },
                    {
                        "name": "customData",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dependents",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dragDropConfig",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "blocked",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busy",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorDelay",
                        "value": 1000,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorSize",
                        "value": "Medium",
                        "use": false
                    },
                    {
                        "name": "visible",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "fieldGroupIds",
                        "value": [
                        "24d987870dc4451495b3a84d2c2850ce"
                        ],
                        "use": false
                    },
                    {
                        "name": "value",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "width",
                        "value": "100%",
                        "use": false
                    },
                    {
                        "name": "enabled",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueState",
                        "value": "None",
                        "use": false
                    },
                    {
                        "name": "name",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "placeholder",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "editable",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueStateText",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "showValueStateMessage",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "textAlign",
                        "value": "Initial",
                        "use": false
                    },
                    {
                        "name": "textDirection",
                        "value": "Inherit",
                        "use": false
                    },
                    {
                        "name": "required",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "ariaLabelledBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "ariaDescribedBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "type",
                        "value": "Text",
                        "use": false
                    },
                    {
                        "name": "maxLength",
                        "value": 0,
                        "use": false
                    },
                    {
                        "name": "dateFormat",
                        "value": "YYYY-MM-dd",
                        "use": false
                    },
                    {
                        "name": "showValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueHelpIconSrc",
                        "value": "sap-icon://value-help",
                        "use": false
                    },
                    {
                        "name": "showSuggestion",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueHelpOnly",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "filterSuggests",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "maxSuggestionWidth",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "startSuggestion",
                        "value": 1,
                        "use": false
                    },
                    {
                        "name": "showTableSuggestionValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "description",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "fieldWidth",
                        "value": "50%",
                        "use": false
                    },
                    {
                        "name": "valueLiveUpdate",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "selectedKey",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "textFormatMode",
                        "value": "Value",
                        "use": false
                    },
                    {
                        "name": "enableSuggestionsHighlighting",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "enableTableAutoPopinMode",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "autocomplete",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "showClearIcon",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "suggestionItems",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionColumns",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionRows",
                        "value": [
                        
                        ],
                        "use": false
                    }
                    ],
                    "bindings": [
                    {
                        "propertyName": "value",
                        "bindingValue": "",
                        "modelPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "propertyPath": "DocumentCurrency",
                        "use": false
                    },
                    {
                        "propertyName": "value",
                        "bindingValue": null,
                        "modelPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "propertyPath": "to_DocumentCurrency/Currency_Text",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "undefined",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "_templPrivGlobaleODESM_C_PurchaseOrderTP",
                        "use": false
                    },
                    {
                        "contextPath": "/ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--objectPage",
                        "modelName": "$cmd",
                        "use": false
                    }
                    ]
                },
                "styleClasses": [
                    "sapUiCompSmartFieldValue",
                    "sapMFocus",
                    "sapMInputFocused"
                ],
                "recordReplaySelector": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet1::DocumentCurrency::Field-input",
                    "value": "United States Dollar (USD)",
                    "text": "Currency"
                },
                "viewInfos": {
                    "absoluteViewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "relativeViewName": "Details"
                },
                "keyCode": 85,
                "key": "United States Dollar (USD)"
                },
                {
                "id": "1bd24ac8-5fad-4341-8452-1c37e696fb8a",
                "actionType": "keypress",
                "actionLocation": "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage&/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)/?sap-iapp-state--history=TASJZZCY7UQNR4G3OI2SN3ZA6TBHRKSN4WE7QT4N1",
                "control": {
                    "controlId": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet2::PurchasingGroup::Field-input",
                    "use": true
                    },
                    "type": "sap.m.Input",
                    "properties": [
                    {
                        "name": "id",
                        "value": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet2::PurchasingGroup::Field-input",
                        "use": false
                    },
                    {
                        "name": "customData",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dependents",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dragDropConfig",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "blocked",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busy",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorDelay",
                        "value": 1000,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorSize",
                        "value": "Medium",
                        "use": false
                    },
                    {
                        "name": "visible",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "fieldGroupIds",
                        "value": [
                        "ab19e2328cc8a716f4717914ac932d27"
                        ],
                        "use": false
                    },
                    {
                        "name": "value",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "width",
                        "value": "100%",
                        "use": false
                    },
                    {
                        "name": "enabled",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueState",
                        "value": "None",
                        "use": false
                    },
                    {
                        "name": "name",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "placeholder",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "editable",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueStateText",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "showValueStateMessage",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "textAlign",
                        "value": "Initial",
                        "use": false
                    },
                    {
                        "name": "textDirection",
                        "value": "Inherit",
                        "use": false
                    },
                    {
                        "name": "required",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "ariaLabelledBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "ariaDescribedBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "type",
                        "value": "Text",
                        "use": false
                    },
                    {
                        "name": "maxLength",
                        "value": 0,
                        "use": false
                    },
                    {
                        "name": "dateFormat",
                        "value": "YYYY-MM-dd",
                        "use": false
                    },
                    {
                        "name": "showValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueHelpIconSrc",
                        "value": "sap-icon://value-help",
                        "use": false
                    },
                    {
                        "name": "showSuggestion",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueHelpOnly",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "filterSuggests",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "maxSuggestionWidth",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "startSuggestion",
                        "value": 1,
                        "use": false
                    },
                    {
                        "name": "showTableSuggestionValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "description",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "fieldWidth",
                        "value": "50%",
                        "use": false
                    },
                    {
                        "name": "valueLiveUpdate",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "selectedKey",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "textFormatMode",
                        "value": "Value",
                        "use": false
                    },
                    {
                        "name": "enableSuggestionsHighlighting",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "enableTableAutoPopinMode",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "autocomplete",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "showClearIcon",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "suggestionItems",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionColumns",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionRows",
                        "value": [
                        
                        ],
                        "use": false
                    }
                    ],
                    "bindings": [
                    {
                        "propertyName": "value",
                        "bindingValue": "",
                        "modelPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "propertyPath": "PurchasingGroup",
                        "use": false
                    },
                    {
                        "propertyName": "value",
                        "bindingValue": "",
                        "modelPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "propertyPath": "PurchasingGroup_Text",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "undefined",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "_templPrivGlobaleODESM_C_PurchaseOrderTP",
                        "use": false
                    },
                    {
                        "contextPath": "/ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--objectPage",
                        "modelName": "$cmd",
                        "use": false
                    }
                    ]
                },
                "styleClasses": [
                    "sapUiCompSmartFieldValue",
                    "sapMFocus",
                    "sapMInputFocused"
                ],
                "recordReplaySelector": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet2::PurchasingGroup::Field-input",
                    "value": "Purch. Group Z00 (Z00)",
                    "text": "Purchasing Group"
                },
                "viewInfos": {
                    "absoluteViewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "relativeViewName": "Details"
                },
                "keyCode": 90,
                "key": "Purch. Group Z00 (Z00)"
                },
                {
                "id": "9b609496-b91d-4556-b01b-ebf3a127178a",
                "actionType": "keypress",
                "actionLocation": "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage&/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)/?sap-iapp-state--history=TASJZZCY7UQNR4G3OI2SN3ZA6TBHRKSN4WE7QT4N1",
                "control": {
                    "controlId": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet1::Supplier::Field-input",
                    "use": true
                    },
                    "type": "sap.m.Input",
                    "properties": [
                    {
                        "name": "id",
                        "value": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet1::Supplier::Field-input",
                        "use": false
                    },
                    {
                        "name": "customData",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dependents",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dragDropConfig",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "blocked",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busy",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorDelay",
                        "value": 1000,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorSize",
                        "value": "Medium",
                        "use": false
                    },
                    {
                        "name": "visible",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "fieldGroupIds",
                        "value": [
                        "2c4e78426c5e9ab3ca86ad30d8a6c2ff"
                        ],
                        "use": false
                    },
                    {
                        "name": "value",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "width",
                        "value": "100%",
                        "use": false
                    },
                    {
                        "name": "enabled",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueState",
                        "value": "None",
                        "use": false
                    },
                    {
                        "name": "name",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "placeholder",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "editable",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueStateText",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "showValueStateMessage",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "textAlign",
                        "value": "Initial",
                        "use": false
                    },
                    {
                        "name": "textDirection",
                        "value": "Inherit",
                        "use": false
                    },
                    {
                        "name": "required",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "ariaLabelledBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "ariaDescribedBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "type",
                        "value": "Text",
                        "use": false
                    },
                    {
                        "name": "maxLength",
                        "value": 0,
                        "use": false
                    },
                    {
                        "name": "dateFormat",
                        "value": "YYYY-MM-dd",
                        "use": false
                    },
                    {
                        "name": "showValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueHelpIconSrc",
                        "value": "sap-icon://value-help",
                        "use": false
                    },
                    {
                        "name": "showSuggestion",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueHelpOnly",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "filterSuggests",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "maxSuggestionWidth",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "startSuggestion",
                        "value": 1,
                        "use": false
                    },
                    {
                        "name": "showTableSuggestionValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "description",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "fieldWidth",
                        "value": "50%",
                        "use": false
                    },
                    {
                        "name": "valueLiveUpdate",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "selectedKey",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "textFormatMode",
                        "value": "Value",
                        "use": false
                    },
                    {
                        "name": "enableSuggestionsHighlighting",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "enableTableAutoPopinMode",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "autocomplete",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "showClearIcon",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "suggestionItems",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionColumns",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionRows",
                        "value": [
                        
                        ],
                        "use": false
                    }
                    ],
                    "bindings": [
                    {
                        "propertyName": "value",
                        "bindingValue": "",
                        "modelPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "propertyPath": "Supplier",
                        "use": false
                    },
                    {
                        "propertyName": "value",
                        "bindingValue": "",
                        "modelPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "propertyPath": "SupplierName",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "undefined",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "_templPrivGlobaleODESM_C_PurchaseOrderTP",
                        "use": false
                    },
                    {
                        "contextPath": "/ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--objectPage",
                        "modelName": "$cmd",
                        "use": false
                    }
                    ]
                },
                "styleClasses": [
                    "sapUiCompSmartFieldValue",
                    "sapMFocus",
                    "sapMInputFocused"
                ],
                "recordReplaySelector": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--GeneralInformationFacet1::Supplier::Field-input",
                    "value": "Domestic US Supplier 1 (17300001)",
                    "text": "Supplier"
                },
                "viewInfos": {
                    "absoluteViewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "relativeViewName": "Details"
                },
                "keyCode": 49,
                "key": "Domestic US Supplier 1 (17300001)"
                },
                {
                "id": "c2cf9325-2e21-410f-92f4-b2fcf109fe67",
                "actionType": "clicked",
                "actionLocation": "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage&/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)/?sap-iapp-state--history=TASJZZCY7UQNR4G3OI2SN3ZA6TBHRKSN4WE7QT4N1",
                "control": {
                    "controlId": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--ItemsFacet::addEntry",
                    "use": true
                    },
                    "type": "sap.m.Button",
                    "properties": [
                    {
                        "name": "accessibleRole",
                        "value": "Default",
                        "use": false
                    },
                    {
                        "name": "activeIcon",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "ariaDescribedBy",
                        "value": [
                        "__text434"
                        ],
                        "use": false
                    },
                    {
                        "name": "ariaHasPopup",
                        "value": "None",
                        "use": false
                    },
                    {
                        "name": "ariaLabelledBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "blocked",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busy",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorDelay",
                        "value": 1000,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorSize",
                        "value": "Medium",
                        "use": false
                    },
                    {
                        "name": "dependents",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dragDropConfig",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "enabled",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "fieldGroupIds",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "icon",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "iconDensityAware",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "iconFirst",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "id",
                        "value": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--ItemsFacet::addEntry",
                        "use": false
                    },
                    {
                        "name": "text",
                        "value": "Create",
                        "use": false
                    },
                    {
                        "name": "textDirection",
                        "value": "Inherit",
                        "use": false
                    },
                    {
                        "name": "type",
                        "value": "Transparent",
                        "use": false
                    },
                    {
                        "name": "visible",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "width",
                        "value": "",
                        "use": false
                    }
                    ],
                    "bindings": [
                    {
                        "propertyName": "visible",
                        "propertyPath": "/editable",
                        "modelName": "ui",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "undefined",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "_templPrivGlobaleODESM_C_PurchaseOrderTP",
                        "use": false
                    },
                    {
                        "contextPath": "/ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--ItemsFacet::Table",
                        "modelName": "$cmd",
                        "use": false
                    }
                    ],
                    "i18nTexts": [
                    {
                        "propertyName": "text",
                        "propertyPath": "CREATE_OBJECT",
                        "bindingValue": "Create",
                        "use": false
                    }
                    ]
                },
                "styleClasses": [
                    "sapMBarChild",
                    "injectClass"
                ],
                "recordReplaySelector": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--ItemsFacet::addEntry",
                    "text": "Create"
                },
                "viewInfos": {
                    "absoluteViewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "relativeViewName": "Details"
                }
                },
                {
                "id": "dbf2da97-02bb-435e-adb9-56c837071951",
                "actionType": "keypress",
                "actionLocation": "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage&/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)/?sap-iapp-state--history=TASJZZCY7UQNR4G3OI2SN3ZA6TBHRKSN4WE7QT4N1",
                "control": {
                    "controlId": {
                    "id": "__field70-__clone389-input",
                    "use": true
                    },
                    "type": "sap.m.Input",
                    "properties": [
                    {
                        "name": "id",
                        "value": "__field70-__clone389-input",
                        "use": false
                    },
                    {
                        "name": "customData",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dependents",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dragDropConfig",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "blocked",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busy",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorDelay",
                        "value": 1000,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorSize",
                        "value": "Medium",
                        "use": false
                    },
                    {
                        "name": "visible",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "fieldGroupIds",
                        "value": [
                        "2b46b2e72119bc54d94d3a9e13d8f98d"
                        ],
                        "use": false
                    },
                    {
                        "name": "value",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "width",
                        "value": "100%",
                        "use": false
                    },
                    {
                        "name": "enabled",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueState",
                        "value": "Error",
                        "use": false
                    },
                    {
                        "name": "name",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "placeholder",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "editable",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueStateText",
                        "value": "Please enter material number or account assignment category",
                        "use": false
                    },
                    {
                        "name": "showValueStateMessage",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "textAlign",
                        "value": "Initial",
                        "use": false
                    },
                    {
                        "name": "textDirection",
                        "value": "Inherit",
                        "use": false
                    },
                    {
                        "name": "required",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "ariaLabelledBy",
                        "value": [
                        "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--ItemsFacet::Table-ManufacturerMaterial-header"
                        ],
                        "use": false
                    },
                    {
                        "name": "ariaDescribedBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "type",
                        "value": "Text",
                        "use": false
                    },
                    {
                        "name": "maxLength",
                        "value": 0,
                        "use": false
                    },
                    {
                        "name": "dateFormat",
                        "value": "YYYY-MM-dd",
                        "use": false
                    },
                    {
                        "name": "showValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueHelpIconSrc",
                        "value": "sap-icon://value-help",
                        "use": false
                    },
                    {
                        "name": "showSuggestion",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueHelpOnly",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "filterSuggests",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "maxSuggestionWidth",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "startSuggestion",
                        "value": 1,
                        "use": false
                    },
                    {
                        "name": "showTableSuggestionValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "description",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "fieldWidth",
                        "value": "50%",
                        "use": false
                    },
                    {
                        "name": "valueLiveUpdate",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "selectedKey",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "textFormatMode",
                        "value": "Value",
                        "use": false
                    },
                    {
                        "name": "enableSuggestionsHighlighting",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "enableTableAutoPopinMode",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "autocomplete",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "showClearIcon",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "suggestionItems",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionColumns",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionRows",
                        "value": [
                        
                        ],
                        "use": false
                    }
                    ],
                    "bindings": [
                    {
                        "propertyName": "value",
                        "bindingValue": "",
                        "modelPath": "/C_PurchaseOrderItemTP(PurchaseOrder='',PurchaseOrderItem='00010',DraftUUID=guid'b3a863c7-1593-1fd0-a198-13682ac0b4f5',IsActiveEntity=false)",
                        "propertyPath": "ManufacturerMaterial",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderItemTP(PurchaseOrder='',PurchaseOrderItem='00010',DraftUUID=guid'b3a863c7-1593-1fd0-a198-13682ac0b4f5',IsActiveEntity=false)",
                        "modelName": "undefined",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "_templPrivGlobaleODESM_C_PurchaseOrderTP",
                        "use": false
                    },
                    {
                        "contextPath": "/ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--ItemsFacet::Table",
                        "modelName": "$cmd",
                        "use": false
                    }
                    ]
                },
                "styleClasses": [
                    "sapUiCompSmartFieldValue",
                    "sapMFocus",
                    "sapMInputFocused"
                ],
                "recordReplaySelector": {
                    "controlType": "sap.m.Input",
                    "viewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "viewId": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP",
                    "bindingPath": {
                    "path": "/C_PurchaseOrderItemTP(PurchaseOrder='',PurchaseOrderItem='00010',DraftUUID=guid'b3a863c7-1593-1fd0-a198-13682ac0b4f5',IsActiveEntity=false)",
                    "propertyPath": "ManufacturerMaterial"
                    },
                    "value": "TG11",
                    "id": "__field70-__clone389-input",
                    "text": "Material"
                },
                "viewInfos": {
                    "absoluteViewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "relativeViewName": "Details"
                },
                "keyCode": 84,
                "key": "TG11"
                },
                {
                "id": "8f110f21-e773-4827-ae47-8aea19d13ca0",
                "actionType": "keypress",
                "actionLocation": "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage&/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)/?sap-iapp-state--history=TASJZZCY7UQNR4G3OI2SN3ZA6TBHRKSN4WE7QT4N1",
                "control": {
                    "controlId": {
                    "id": "__field76-__clone389-input",
                    "use": true
                    },
                    "type": "sap.m.Input",
                    "properties": [
                    {
                        "name": "id",
                        "value": "__field76-__clone389-input",
                        "use": false
                    },
                    {
                        "name": "customData",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dependents",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dragDropConfig",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "blocked",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busy",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorDelay",
                        "value": 1000,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorSize",
                        "value": "Medium",
                        "use": false
                    },
                    {
                        "name": "visible",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "fieldGroupIds",
                        "value": [
                        "8fa61902590988c86dc5f636a40b0487"
                        ],
                        "use": false
                    },
                    {
                        "name": "value",
                        "value": "0",
                        "use": false
                    },
                    {
                        "name": "width",
                        "value": "100%",
                        "use": false
                    },
                    {
                        "name": "enabled",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueState",
                        "value": "Error",
                        "use": false
                    },
                    {
                        "name": "name",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "placeholder",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "editable",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "valueStateText",
                        "value": "Enter a quantity",
                        "use": false
                    },
                    {
                        "name": "showValueStateMessage",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "textAlign",
                        "value": "Right",
                        "use": false
                    },
                    {
                        "name": "textDirection",
                        "value": "Inherit",
                        "use": false
                    },
                    {
                        "name": "required",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "ariaLabelledBy",
                        "value": [
                        "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--ItemsFacet::Table-OrderQuantity-header"
                        ],
                        "use": false
                    },
                    {
                        "name": "ariaDescribedBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "type",
                        "value": "Text",
                        "use": false
                    },
                    {
                        "name": "maxLength",
                        "value": 0,
                        "use": false
                    },
                    {
                        "name": "dateFormat",
                        "value": "YYYY-MM-dd",
                        "use": false
                    },
                    {
                        "name": "showValueHelp",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "valueHelpIconSrc",
                        "value": "sap-icon://value-help",
                        "use": false
                    },
                    {
                        "name": "showSuggestion",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "valueHelpOnly",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "filterSuggests",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "maxSuggestionWidth",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "startSuggestion",
                        "value": 1,
                        "use": false
                    },
                    {
                        "name": "showTableSuggestionValueHelp",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "description",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "fieldWidth",
                        "value": "50%",
                        "use": false
                    },
                    {
                        "name": "valueLiveUpdate",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "selectedKey",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "textFormatMode",
                        "value": "Value",
                        "use": false
                    },
                    {
                        "name": "enableSuggestionsHighlighting",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "enableTableAutoPopinMode",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "autocomplete",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "showClearIcon",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "suggestionItems",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionColumns",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "suggestionRows",
                        "value": [
                        
                        ],
                        "use": false
                    }
                    ],
                    "bindings": [
                    {
                        "propertyName": "value",
                        "bindingValue": "0",
                        "modelPath": "/C_PurchaseOrderItemTP(PurchaseOrder='',PurchaseOrderItem='00010',DraftUUID=guid'b3a863c7-1593-1fd0-a198-13682ac0b4f5',IsActiveEntity=false)",
                        "propertyPath": "OrderQuantity",
                        "use": false
                    },
                    {
                        "propertyName": "value",
                        "bindingValue": "PC",
                        "modelPath": "/C_PurchaseOrderItemTP(PurchaseOrder='',PurchaseOrderItem='00010',DraftUUID=guid'b3a863c7-1593-1fd0-a198-13682ac0b4f5',IsActiveEntity=false)",
                        "propertyPath": "PurchaseOrderQuantityUnit",
                        "use": false
                    },
                    {
                        "propertyName": "value",
                        "bindingValue": {
                        "005": {
                            "Text": "",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "006": {
                            "Text": "",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "007": {
                            "Text": "",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "009": {
                            "Text": "",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "001": {
                            "Text": "",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "YPD": {
                            "Text": "Person Day",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "QMM": {
                            "Text": "Cubic meter per meter",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "RQt": {
                            "Text": "Reciprocal Milligram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "RKG": {
                            "Text": "Reciprocal Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MLR": {
                            "Text": "Mega Liter",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "NCH": {
                            "Text": "Nanogram/Square Centim. Hr",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "UG": {
                            "Text": "µg",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MC"
                        },
                        "KMT": {
                            "Text": "Kilograms/Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KGL": {
                            "Text": "Kilogram/Mile",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GRH": {
                            "Text": "Gram/Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GML": {
                            "Text": "Gram/Mile",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GUT": {
                            "Text": "Gram/US Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GMB": {
                            "Text": "Gram/Million BTU",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GKH": {
                            "Text": "Grams/Kilowatt Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GGL": {
                            "Text": "Gram/US Gallon",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "UG6": {
                            "Text": "US Gallons 60F",
                            "UnitSpecificScale": 3,
                            "StandardCode": "_12"
                        },
                        "FAH": {
                            "Text": "Fahrenheit",
                            "UnitSpecificScale": 2,
                            "StandardCode": ""
                        },
                        "JG": {
                            "Text": "Joules/Gram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "D95"
                        },
                        "BC3": {
                            "Text": "BTU/Cubic Foot at 14.65/60/SD",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "BC2": {
                            "Text": "BTU/Cubic Foot at 14.73/60/SD",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "BC1": {
                            "Text": "BTU/Cubic Foot at 15.025/60/SD",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "LMH": {
                            "Text": "Pound/Megawatt-Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "LA": {
                            "Text": "Liters of Alcohol",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "Kcl": {
                            "Text": "kilocalorie",
                            "UnitSpecificScale": 0,
                            "StandardCode": "E14"
                        },
                        "MCF": {
                            "Text": "One Million Cubic Feet",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "MC3": {
                            "Text": "One Thousand Cu. Ft 14,65 PSI",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "MC2": {
                            "Text": "One Thousand Cu. Ft 14,73 PSI",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MC1": {
                            "Text": "One Thousand Cu. Ft 15,025 PSI",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "MBD": {
                            "Text": "One Million BTU (60 FAH, SD)",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "KEL": {
                            "Text": "Kilogram/Kilowatt-Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "JM3": {
                            "Text": "Joule per Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KMI": {
                            "Text": "Kilograms/Minute",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KKW": {
                            "Text": "Kilogram/Megawatt-Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "RHO": {
                            "Text": "Gram/Cubic Centimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "23"
                        },
                        "QT": {
                            "Text": "Quart, US Liquid",
                            "UnitSpecificScale": 0,
                            "StandardCode": "QT"
                        },
                        "PT": {
                            "Text": "Pint, US Liquid",
                            "UnitSpecificScale": 0,
                            "StandardCode": "PT"
                        },
                        "PSI": {
                            "Text": "Pound/Square Inch",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "PS": {
                            "Text": "Picosecond",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "PRS": {
                            "Text": "Number of Persons",
                            "UnitSpecificScale": 0,
                            "StandardCode": "IE"
                        },
                        "PRM": {
                            "Text": "Permeation Rate",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "PPT": {
                            "Text": "Parts per trillion",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "PPM": {
                            "Text": "Parts per Million",
                            "UnitSpecificScale": 0,
                            "StandardCode": "59"
                        },
                        "PPB": {
                            "Text": "Parts per billion",
                            "UnitSpecificScale": 0,
                            "StandardCode": "61"
                        },
                        "PMR": {
                            "Text": "Permeation Rate SI",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "PMI": {
                            "Text": "1/minute",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "PDA": {
                            "Text": "Consultant Days",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "PRC": {
                            "Text": "Group proportion",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "PAS": {
                            "Text": "Pascal second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C65"
                        },
                        "PAL": {
                            "Text": "Pallet",
                            "UnitSpecificScale": 0,
                            "StandardCode": "PF"
                        },
                        "PAC": {
                            "Text": "Pack",
                            "UnitSpecificScale": 0,
                            "StandardCode": "PK"
                        },
                        "PAA": {
                            "Text": "Pair",
                            "UnitSpecificScale": 0,
                            "StandardCode": "PR"
                        },
                        "PA": {
                            "Text": "Pascal",
                            "UnitSpecificScale": 0,
                            "StandardCode": "PAL"
                        },
                        "P": {
                            "Text": "Points",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "FOZ": {
                            "Text": "Fluid Ounce US",
                            "UnitSpecificScale": 0,
                            "StandardCode": "OZA"
                        },
                        "OZ": {
                            "Text": "Ounce",
                            "UnitSpecificScale": 0,
                            "StandardCode": "ONZ"
                        },
                        "OM": {
                            "Text": "Specific Electrical Resistance",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C61"
                        },
                        "OHM": {
                            "Text": "Ohm",
                            "UnitSpecificScale": 0,
                            "StandardCode": "OHM"
                        },
                        "Tot": {
                            "Text": "Ton/US Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TPH": {
                            "Text": "Tonne/Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TMO": {
                            "Text": "Tonne/Month",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TON": {
                            "Text": "US Ton",
                            "UnitSpecificScale": 3,
                            "StandardCode": "STN"
                        },
                        "TO": {
                            "Text": "Ton",
                            "UnitSpecificScale": 3,
                            "StandardCode": "TNE"
                        },
                        "TM3": {
                            "Text": "1/cubic meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TKT": {
                            "Text": "Ton/Kiloton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tkl": {
                            "Text": "Ton/1000 Liter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TYR": {
                            "Text": "Ton/Year",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tha": {
                            "Text": "Ton per Hectare",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TS": {
                            "Text": "Thousands",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MIL"
                        },
                        "TEU": {
                            "Text": "Twenty-Foot Equivalent Unit",
                            "UnitSpecificScale": 0,
                            "StandardCode": "E22"
                        },
                        "TES": {
                            "Text": "Tesla",
                            "UnitSpecificScale": 0,
                            "StandardCode": "D33"
                        },
                        "TCM": {
                            "Text": "Particle/Cubic Centimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TC3": {
                            "Text": "1/cubic centimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TBQ": {
                            "Text": "Terabecquerel",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "DAY": {
                            "Text": "Days",
                            "UnitSpecificScale": 0,
                            "StandardCode": "DAY"
                        },
                        "SVS": {
                            "Text": "Sieverts per second",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "SVH": {
                            "Text": "Sieverts per hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "HR": {
                            "Text": "Hours",
                            "UnitSpecificScale": 3,
                            "StandardCode": "HUR"
                        },
                        "PC": {
                            "Text": "Piece",
                            "UnitSpecificScale": 0,
                            "StandardCode": "PCE"
                        },
                        "S": {
                            "Text": "Seconds",
                            "UnitSpecificScale": 0,
                            "StandardCode": "SEC"
                        },
                        "ROL": {
                            "Text": "Roll",
                            "UnitSpecificScale": 0,
                            "StandardCode": "RO"
                        },
                        "MPA": {
                            "Text": "Megapascal",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MPA"
                        },
                        "MON": {
                            "Text": "Months",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MON"
                        },
                        "MOL": {
                            "Text": "Mole",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C34"
                        },
                        "MOK": {
                            "Text": "Mole/Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C19"
                        },
                        "MNM": {
                            "Text": "Millinewton/meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C22"
                        },
                        "MMS": {
                            "Text": "Millimeter/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C16"
                        },
                        "MM3": {
                            "Text": "Cubic millimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MMQ"
                        },
                        "MMO": {
                            "Text": "Millimole",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C18"
                        },
                        "MMK": {
                            "Text": "Millimole/Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "D87"
                        },
                        "MMH": {
                            "Text": "Millimeter/hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MMG": {
                            "Text": "Millimole/Gram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MMA": {
                            "Text": "Millimeter/year",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MM2": {
                            "Text": "Square millimeter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MMK"
                        },
                        "MM": {
                            "Text": "Millimeter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MMT"
                        },
                        "MLI": {
                            "Text": "Milliliter Active Ingredient",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MLK": {
                            "Text": "Milliliter/cubic meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "ML": {
                            "Text": "Milliliter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MLT"
                        },
                        "MJK": {
                            "Text": "Megajoules/Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MIJ": {
                            "Text": "Millijoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C15"
                        },
                        "MIS": {
                            "Text": "Microsecond",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B98"
                        },
                        "MIN": {
                            "Text": "Minutes",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MIN"
                        },
                        "µM": {
                            "Text": "Micrometer",
                            "UnitSpecificScale": 3,
                            "StandardCode": "4H"
                        },
                        "mil": {
                            "Text": "Milliinch",
                            "UnitSpecificScale": 0,
                            "StandardCode": "77"
                        },
                        "MI2": {
                            "Text": "Square Mile",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MIK"
                        },
                        "OCM": {
                            "Text": "Specific Electrical Resistance",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C60"
                        },
                        "NS": {
                            "Text": "Nanosecond",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C47"
                        },
                        "NM": {
                            "Text": "Newton/meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "4P"
                        },
                        "NGT": {
                            "Text": "Nanogram/Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "NAM": {
                            "Text": "Nanometer",
                            "UnitSpecificScale": 3,
                            "StandardCode": "C45"
                        },
                        "N": {
                            "Text": "Newton",
                            "UnitSpecificScale": 0,
                            "StandardCode": "NEW"
                        },
                        "MWH": {
                            "Text": "Megawatt hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MWH"
                        },
                        "MW": {
                            "Text": "Milliwatt",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C31"
                        },
                        "MVA": {
                            "Text": "Megavoltampere",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MVA"
                        },
                        "MV": {
                            "Text": "Millivolt",
                            "UnitSpecificScale": 0,
                            "StandardCode": "2Z"
                        },
                        "MTf": {
                            "Text": "Million Particles/Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "M/H": {
                            "Text": "Meter/Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MTM": {
                            "Text": "Million Particles/Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MTE": {
                            "Text": "Millitesla",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C29"
                        },
                        "MSH": {
                            "Text": "Millisieverts per hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MS2": {
                            "Text": "Meter/Square Second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MSK"
                        },
                        "MSE": {
                            "Text": "Millisecond",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C26"
                        },
                        "M3H": {
                            "Text": "Cubic Meter/Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MQH"
                        },
                        "MPZ": {
                            "Text": "Meterpascal/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MPT": {
                            "Text": "Mass parts per trillion",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MPS": {
                            "Text": "Millipascal Seconds",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C24"
                        },
                        "MPM": {
                            "Text": "Mass parts per million",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MPG": {
                            "Text": "Miles per gallon (US)",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "MPB": {
                            "Text": "Mass parts per billion",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "sMb": {
                            "Text": "Std Cubic Foot/Mill. US Barrel",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "sM3": {
                            "Text": "Spores/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "pGQ": {
                            "Text": "Picogram/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "nGQ": {
                            "Text": "Nanogram/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "nGJ": {
                            "Text": "Nanogram/Gigajoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mmB": {
                            "Text": "Millions British Thermal Unit",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "uGJ": {
                            "Text": "Microgram/Gigajoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mjm": {
                            "Text": "Megajoule/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mbt": {
                            "Text": "Million BTU/US Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mbs": {
                            "Text": "Million BTU/Std Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mbm": {
                            "Text": "MMBtu/Mill. Std Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mbl": {
                            "Text": "Millions BTU/Pound",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mbk": {
                            "Text": "Million BTU/Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mbg": {
                            "Text": "Million BTU/US Gallon",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mbb": {
                            "Text": "Million BTU/US Barrel",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mHg": {
                            "Text": "Millimeters of Mercury",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "mGJ": {
                            "Text": "Milligram/Gigajoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lth": {
                            "Text": "US Pound/1000 Horsepower Hr.",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "ltg": {
                            "Text": "US Pound/Thousand US Gallons",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "ltf": {
                            "Text": "US Pound/1000 Cubic Feet",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "ltb": {
                            "Text": "US Pound/1000 US Barrels",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lmg": {
                            "Text": "US Pound/Millions US Gallons",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lmf": {
                            "Text": "US Pound/Million Cubic Feet",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lht": {
                            "Text": "US Pound/100,000 Hp Hr",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lhh": {
                            "Text": "US Pound/Horsepower Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "ttj": {
                            "Text": "Ton/Terajoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tt": {
                            "Text": "Ton/Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tot": {
                            "Text": "US Ton/US Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tph": {
                            "Text": "US Tonne/Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "T/M": {
                            "Text": "US Tonne/Month",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tm3": {
                            "Text": "Ton/1000 Cubic Meters",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tjl": {
                            "Text": "Ton/Joule",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "Thm": {
                            "Text": "Therm (EC)",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tgl": {
                            "Text": "US Ton/US Gallon",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tbt": {
                            "Text": "Ton/British Thermal Unit",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tbl": {
                            "Text": "Ton/US Barrel",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tMs": {
                            "Text": "Ton/Mill. Standard Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "tMb": {
                            "Text": "Ton/Millions US Barrel",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "TYr": {
                            "Text": "US Tonne/Year",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "scy": {
                            "Text": "Standard Cubic Foot/Year",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "sch": {
                            "Text": "Standard Cubic Foot/Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "scf": {
                            "Text": "Standard Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "bgl": {
                            "Text": "British Thermal Unit/US Gallon",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "bft": {
                            "Text": "British Thermal Unit/Cubic Ft",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B0"
                        },
                        "bbl": {
                            "Text": "British Thermal Unit/US Barrel",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "Bmo": {
                            "Text": "British Thermal Unit/Month",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "BYr": {
                            "Text": "British Thermal Unit/Year",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "YD3": {
                            "Text": "Cubic yard",
                            "UnitSpecificScale": 0,
                            "StandardCode": "YDQ"
                        },
                        "YD2": {
                            "Text": "Square Yard",
                            "UnitSpecificScale": 0,
                            "StandardCode": "YDK"
                        },
                        "YD": {
                            "Text": "Yards",
                            "UnitSpecificScale": 0,
                            "StandardCode": "YRD"
                        },
                        "WKY": {
                            "Text": "Evaporation Rate",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "WMP": {
                            "Text": "Watt/sqm./parts per billon",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "WMK": {
                            "Text": "Heat Conductivity",
                            "UnitSpecificScale": 0,
                            "StandardCode": "D53"
                        },
                        "WK": {
                            "Text": "Weeks",
                            "UnitSpecificScale": 0,
                            "StandardCode": "WEE"
                        },
                        "W": {
                            "Text": "Watt",
                            "UnitSpecificScale": 0,
                            "StandardCode": "WTT"
                        },
                        "VPT": {
                            "Text": "Volume parts per trillion",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "VPM": {
                            "Text": "Volume parts per million",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "VPB": {
                            "Text": "Volume parts per billion",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "VAL": {
                            "Text": "Value-Only Material",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MPL": {
                            "Text": "Millimole per Liter",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "MSC": {
                            "Text": "Microsiemens per centimeter",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "V%O": {
                            "Text": "Permille volume",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "V%": {
                            "Text": "Percent volume",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "V": {
                            "Text": "Volt",
                            "UnitSpecificScale": 0,
                            "StandardCode": "VLT"
                        },
                        "USH": {
                            "Text": "Microsieverts per hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "µGL": {
                            "Text": "Microgram/liter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lcm": {
                            "Text": "Liter/Cubic Centimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lbt": {
                            "Text": "US Pound/US Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lbs": {
                            "Text": "US Pound/Standard Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lbm": {
                            "Text": "US Pound/Million BTU",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lbl": {
                            "Text": "US Pound/US Pound Mole",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "lbg": {
                            "Text": "US Pound/US Gallon",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GE"
                        },
                        "lbb": {
                            "Text": "US Pound/British Thermal Unit",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "kwk": {
                            "Text": "Kilowatt Hour/Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "kml": {
                            "Text": "Kilogram/Kilogram Mole",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "kgt": {
                            "Text": "Kilogram/US Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "kgs": {
                            "Text": "Kilogram/Standard Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "kgm": {
                            "Text": "Kilogram/Million BTU",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "kgj": {
                            "Text": "Kilogram/Joule",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "kgg": {
                            "Text": "Kilogram/US Gallon",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "kgb": {
                            "Text": "Kilogram/US Barrel",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "jm3": {
                            "Text": "Joule/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "gjt": {
                            "Text": "Gigajoule/US Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "gjm": {
                            "Text": "Gigajoule/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "gj3": {
                            "Text": "Gigajoule/1000 Cubic Meters",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "gGJ": {
                            "Text": "Gram/Gigajoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "fml": {
                            "Text": "Fibers/Milliliter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "fm3": {
                            "Text": "Fibers/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "fcm": {
                            "Text": "Fibers/Cubic Centimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "btl": {
                            "Text": "British Thermal Unit/US Pound",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "BSC": {
                            "Text": "BTU/Standard Cubic Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MI": {
                            "Text": "Mile",
                            "UnitSpecificScale": 3,
                            "StandardCode": "SMI"
                        },
                        "FT3": {
                            "Text": "Cubic foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": "FTQ"
                        },
                        "FT2": {
                            "Text": "Square foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": "FTK"
                        },
                        "FT": {
                            "Text": "Foot",
                            "UnitSpecificScale": 0,
                            "StandardCode": "FOT"
                        },
                        "°F": {
                            "Text": "Fahrenheit",
                            "UnitSpecificScale": 0,
                            "StandardCode": "FAH"
                        },
                        "F": {
                            "Text": "Farad",
                            "UnitSpecificScale": 0,
                            "StandardCode": "FAR"
                        },
                        "EML": {
                            "Text": "Enzyme Units/Milliliter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "EU": {
                            "Text": "Enzyme Units",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "EA": {
                            "Text": "Each",
                            "UnitSpecificScale": 0,
                            "StandardCode": "EA"
                        },
                        "DZ": {
                            "Text": "Dozen",
                            "UnitSpecificScale": 0,
                            "StandardCode": "DZN"
                        },
                        "DR": {
                            "Text": "Drum",
                            "UnitSpecificScale": 0,
                            "StandardCode": "DR"
                        },
                        "DM": {
                            "Text": "Decimeter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "DMT"
                        },
                        "DGP": {
                            "Text": "ADR DG Exemption Points",
                            "UnitSpecificScale": 2,
                            "StandardCode": ""
                        },
                        "DEG": {
                            "Text": "Degree",
                            "UnitSpecificScale": 3,
                            "StandardCode": "DD"
                        },
                        "dBC": {
                            "Text": "Decibels (C Weighting)",
                            "UnitSpecificScale": 1,
                            "StandardCode": ""
                        },
                        "dBA": {
                            "Text": "Decibels (A Weighting)",
                            "UnitSpecificScale": 1,
                            "StandardCode": ""
                        },
                        "VAM": {
                            "Text": "Voltampere",
                            "UnitSpecificScale": 0,
                            "StandardCode": "D46"
                        },
                        "TOM": {
                            "Text": "Ton/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "D41"
                        },
                        "S/M": {
                            "Text": "Siemens per meter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "D10"
                        },
                        "CL": {
                            "Text": "Centiliter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "CLT"
                        },
                        "CV": {
                            "Text": "Case",
                            "UnitSpecificScale": 0,
                            "StandardCode": "CS"
                        },
                        "COP": {
                            "Text": "Copies",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "CMH": {
                            "Text": "Centimeter/hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "HZ": {
                            "Text": "Hertz (1/second)",
                            "UnitSpecificScale": 0,
                            "StandardCode": "HTZ"
                        },
                        "HPA": {
                            "Text": "Hectopascal",
                            "UnitSpecificScale": 0,
                            "StandardCode": "A97"
                        },
                        "HL": {
                            "Text": "Hectoliter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "HLT"
                        },
                        "HA": {
                            "Text": "Hectare",
                            "UnitSpecificScale": 0,
                            "StandardCode": "HAR"
                        },
                        "H": {
                            "Text": "Hours",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "GAI": {
                            "Text": "Gram Active Ingredient",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GT": {
                            "Text": "Gram/Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GRO": {
                            "Text": "Gross",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GRO"
                        },
                        "µGQ": {
                            "Text": "Microgram/cubic meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GQ"
                        },
                        "GPH": {
                            "Text": "Gallons per hour (US)",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "GM2": {
                            "Text": "Gram/square meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GM"
                        },
                        "GM": {
                            "Text": "Gram/Mole",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GPM": {
                            "Text": "Gallons per mile (US)",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "GAL": {
                            "Text": "US Gallon",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GLL"
                        },
                        "GLI": {
                            "Text": "Gram/liter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GL"
                        },
                        "GKG": {
                            "Text": "Gram/kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GK"
                        },
                        "GJT": {
                            "Text": "Gigajoules/Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GJC": {
                            "Text": "Gigajoule/Kiloliter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "GJ": {
                            "Text": "Gigajoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GV"
                        },
                        "GHG": {
                            "Text": "Gram/hectogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "°C": {
                            "Text": "Degrees Celsius",
                            "UnitSpecificScale": 0,
                            "StandardCode": "CEL"
                        },
                        "GBQ": {
                            "Text": "Gigabecquerel",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GBQ"
                        },
                        "GAU": {
                            "Text": "Gram Gold",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "G/L": {
                            "Text": "Gram Active Ingredient/Liter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "G": {
                            "Text": "Gram",
                            "UnitSpecificScale": 3,
                            "StandardCode": "GRM"
                        },
                        "BBL": {
                            "Text": "Barrels",
                            "UnitSpecificScale": 3,
                            "StandardCode": "5A"
                        },
                        "BB6": {
                            "Text": "Barrel 60°F",
                            "UnitSpecificScale": 3,
                            "StandardCode": "_22"
                        },
                        "BAR": {
                            "Text": "bar",
                            "UnitSpecificScale": 0,
                            "StandardCode": "BAR"
                        },
                        "BAG": {
                            "Text": "Bag",
                            "UnitSpecificScale": 0,
                            "StandardCode": "BG"
                        },
                        "µA": {
                            "Text": "Microampere",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B84"
                        },
                        "MHV": {
                            "Text": "Megavolt",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B78"
                        },
                        "MGO": {
                            "Text": "Megohm",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B75"
                        },
                        "MN": {
                            "Text": "Meganewton",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B73"
                        },
                        "NI": {
                            "Text": "Kilonewton",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B47"
                        },
                        "KML": {
                            "Text": "Kilomol",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B45"
                        },
                        "KD3": {
                            "Text": "Kilogram/cubic decimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B34"
                        },
                        "ACR": {
                            "Text": "Acre",
                            "UnitSpecificScale": 0,
                            "StandardCode": "ACR"
                        },
                        "GM3": {
                            "Text": "Gram/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "A93"
                        },
                        "GOH": {
                            "Text": "Gigaohm",
                            "UnitSpecificScale": 0,
                            "StandardCode": "A87"
                        },
                        "A": {
                            "Text": "Ampere",
                            "UnitSpecificScale": 0,
                            "StandardCode": "AMP"
                        },
                        "PF": {
                            "Text": "Picofarad",
                            "UnitSpecificScale": 0,
                            "StandardCode": "4T"
                        },
                        "µF": {
                            "Text": "Microfarad",
                            "UnitSpecificScale": 0,
                            "StandardCode": "4O"
                        },
                        "µL": {
                            "Text": "Microliter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "4G"
                        },
                        "MMI": {
                            "Text": "Meter/Minute",
                            "UnitSpecificScale": 0,
                            "StandardCode": "2X"
                        },
                        "CMS": {
                            "Text": "Centimeter/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "2M"
                        },
                        "22S": {
                            "Text": "Square millimeter/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "D": {
                            "Text": "Days",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "ONE": {
                            "Text": "One",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "%O": {
                            "Text": "Per Mille",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "%": {
                            "Text": "Percentage",
                            "UnitSpecificScale": 3,
                            "StandardCode": "P1"
                        },
                        "CM2": {
                            "Text": "Square centimeter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "CMK"
                        },
                        "CM": {
                            "Text": "Centimeter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "CMT"
                        },
                        "CD3": {
                            "Text": "Cubic decimeter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "DMQ"
                        },
                        "CD": {
                            "Text": "Candela",
                            "UnitSpecificScale": 0,
                            "StandardCode": "CDL"
                        },
                        "CCM": {
                            "Text": "Cubic centimeter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "CMQ"
                        },
                        "CCK": {
                            "Text": "Cubic Centimeters per Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "CCK"
                        },
                        "NMM": {
                            "Text": "Newton/Square Millimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C56"
                        },
                        "R-U": {
                            "Text": "Nanofarad",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C41"
                        },
                        "C3S": {
                            "Text": "Cubic centimeter/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "2J"
                        },
                        "NA": {
                            "Text": "Nanoampere",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C39"
                        },
                        "M/L": {
                            "Text": "Mole per Liter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "C38"
                        },
                        "M/M": {
                            "Text": "Mole per Cubic Meter",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "RF": {
                            "Text": "Millifarad",
                            "UnitSpecificScale": 0,
                            "StandardCode": "C10"
                        },
                        "Bqm": {
                            "Text": "Becquerel/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "BTU": {
                            "Text": "British Thermal Unit",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "BQK": {
                            "Text": "Becquerel/kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "A18"
                        },
                        "BQG": {
                            "Text": "Becquerels per gram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "BQ2": {
                            "Text": "Becquerels per square cm",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "BQ": {
                            "Text": "Becquerel (1/Second)",
                            "UnitSpecificScale": 0,
                            "StandardCode": "BQL"
                        },
                        "BT": {
                            "Text": "Bottle",
                            "UnitSpecificScale": 0,
                            "StandardCode": "BO"
                        },
                        "BOE": {
                            "Text": "Barrels of Oil Equivalent",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "BM2": {
                            "Text": "Becquerels per Square Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "\"": {
                            "Text": "Inch",
                            "UnitSpecificScale": 3,
                            "StandardCode": "INH"
                        },
                        "M3": {
                            "Text": "Cubic meter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MTQ"
                        },
                        "M2S": {
                            "Text": "Square meter/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "S4"
                        },
                        "M2M": {
                            "Text": "Square meter/cubic meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "M2K": {
                            "Text": "Square meter/kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "D21"
                        },
                        "M-2": {
                            "Text": "1/Square Meter",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "M2G": {
                            "Text": "Square meter/gram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "M2C": {
                            "Text": "Square meter/cubic centimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "M2": {
                            "Text": "Square meter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MTK"
                        },
                        "M/S": {
                            "Text": "Meter/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MTS"
                        },
                        "M%O": {
                            "Text": "Permille mass",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "M%": {
                            "Text": "Percent mass",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "M": {
                            "Text": "Meter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MTR"
                        },
                        "LPH": {
                            "Text": "Liter per hour",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "LMS": {
                            "Text": "Liter/Mole Second",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "LM": {
                            "Text": "Length in Meters per Unit",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "LHK": {
                            "Text": "Liter per 100 km",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "AU": {
                            "Text": "Activity unit",
                            "UnitSpecificScale": 3,
                            "StandardCode": "C62"
                        },
                        "lbM": {
                            "Text": "Pound/Month",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "DYr": {
                            "Text": "Pound/Year",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "LB": {
                            "Text": "US pound",
                            "UnitSpecificScale": 0,
                            "StandardCode": "LBR"
                        },
                        "LMI": {
                            "Text": "Liter/Minute",
                            "UnitSpecificScale": 0,
                            "StandardCode": "L2"
                        },
                        "L": {
                            "Text": "Liter",
                            "UnitSpecificScale": 3,
                            "StandardCode": "LTR"
                        },
                        "MHZ": {
                            "Text": "Megahertz",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MHZ"
                        },
                        "MGq": {
                            "Text": "Milligram/10 Cubic Meters",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MGW": {
                            "Text": "Megawatt",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MAW"
                        },
                        "MGT": {
                            "Text": "Milligram/Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MGQ": {
                            "Text": "Milligram/cubic meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "GP"
                        },
                        "MGL": {
                            "Text": "Milligram/liter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "M1"
                        },
                        "MGK": {
                            "Text": "Milligram/kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "NA"
                        },
                        "MGJ": {
                            "Text": "Gram/Cubic Meter/Kilopascal",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MGG": {
                            "Text": "Milligram/gram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MGE": {
                            "Text": "Milligram/Square centimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MG": {
                            "Text": "Milligram",
                            "UnitSpecificScale": 3,
                            "StandardCode": "MGM"
                        },
                        "MEJ": {
                            "Text": "Megajoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": "3B"
                        },
                        "MBZ": {
                            "Text": "Meterbar/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MBQ": {
                            "Text": "Megabecquerel",
                            "UnitSpecificScale": 0,
                            "StandardCode": "4N"
                        },
                        "MBG": {
                            "Text": "Megabecquerels per gram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MBA": {
                            "Text": "Millibar",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MBR"
                        },
                        "MB2": {
                            "Text": "Megabecquerel/sq. centimeter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "MA": {
                            "Text": "Milliampere",
                            "UnitSpecificScale": 0,
                            "StandardCode": "4K"
                        },
                        "M3S": {
                            "Text": "Cubic meter/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "MQS"
                        },
                        "M3D": {
                            "Text": "Cubic meter/day",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KGT": {
                            "Text": "Kilogram/Ton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KGS": {
                            "Text": "Kilogram/second",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KGS"
                        },
                        "KGM": {
                            "Text": "Kilogram/Mole",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KGK": {
                            "Text": "Kilogram/Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KGJ": {
                            "Text": "Kilogram/Gigajoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KGH": {
                            "Text": "Kilogram/Hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KGF": {
                            "Text": "Kilogram/Square meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "28"
                        },
                        "KG": {
                            "Text": "Kilogram",
                            "UnitSpecificScale": 3,
                            "StandardCode": "KGM"
                        },
                        "KBQ": {
                            "Text": "Kilobecquerel",
                            "UnitSpecificScale": 0,
                            "StandardCode": "2Q"
                        },
                        "KBK": {
                            "Text": "Kilobecquerel/Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B25"
                        },
                        "KBG": {
                            "Text": "Kilobecquerels per gram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KB2": {
                            "Text": "Kilobecquerels per square cm",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "CAR": {
                            "Text": "Carton",
                            "UnitSpecificScale": 0,
                            "StandardCode": "CT"
                        },
                        "CAN": {
                            "Text": "Canister",
                            "UnitSpecificScale": 0,
                            "StandardCode": "CA"
                        },
                        "KA": {
                            "Text": "Kiloampere",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B22"
                        },
                        "K": {
                            "Text": "Kelvin",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KEL"
                        },
                        "JMO": {
                            "Text": "Joule/Mole",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B15"
                        },
                        "JKK": {
                            "Text": "Spec. Heat Capacity",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B11"
                        },
                        "JKG": {
                            "Text": "Joule/Kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "J2"
                        },
                        "YR": {
                            "Text": "Years",
                            "UnitSpecificScale": 0,
                            "StandardCode": "ANN"
                        },
                        "J": {
                            "Text": "Joule",
                            "UnitSpecificScale": 0,
                            "StandardCode": "JOU"
                        },
                        "\"3": {
                            "Text": "Cubic inch",
                            "UnitSpecificScale": 0,
                            "StandardCode": "INQ"
                        },
                        "\"2": {
                            "Text": "Square inch",
                            "UnitSpecificScale": 0,
                            "StandardCode": "INK"
                        },
                        "KWM": {
                            "Text": "Kilowatt Hours/Cubic Meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KIK": {
                            "Text": "kg Active Ingredient/kg",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KWH": {
                            "Text": "Kilowatt hour",
                            "UnitSpecificScale": 3,
                            "StandardCode": "KWH"
                        },
                        "KW": {
                            "Text": "Kilowatt",
                            "UnitSpecificScale": 3,
                            "StandardCode": "KWT"
                        },
                        "KVA": {
                            "Text": "Kilovoltampere",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KVA"
                        },
                        "KV": {
                            "Text": "Kilovolt",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KVT"
                        },
                        "KT": {
                            "Text": "Kiloton",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KPA": {
                            "Text": "Kilopascal",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KPA"
                        },
                        "KOH": {
                            "Text": "Kiloohm",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B49"
                        },
                        "KMS": {
                            "Text": "Kelvin/Second",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KMN": {
                            "Text": "Kelvin/Minute",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KMK": {
                            "Text": "Cubic meter/Cubic meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KGV": {
                            "Text": "Kilogram/cubic meter",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KMQ"
                        },
                        "KAI": {
                            "Text": "Kilogram Active Ingredient",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KHZ": {
                            "Text": "Kilohertz",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KHZ"
                        },
                        "CRT": {
                            "Text": "Crate",
                            "UnitSpecificScale": 0,
                            "StandardCode": "CR"
                        },
                        "KJ": {
                            "Text": "Kilojoule",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KJO"
                        },
                        "KJG": {
                            "Text": "Kilojoule/gram",
                            "UnitSpecificScale": 0,
                            "StandardCode": ""
                        },
                        "KMH": {
                            "Text": "Kilometer/hour",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KMH"
                        },
                        "KM2": {
                            "Text": "Square kilometer",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KMK"
                        },
                        "KM": {
                            "Text": "Kilometer",
                            "UnitSpecificScale": 0,
                            "StandardCode": "KMT"
                        },
                        "KJK": {
                            "Text": "Kilojoule/kilogram",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B42"
                        },
                        "KJM": {
                            "Text": "Kilojoule/Mole",
                            "UnitSpecificScale": 0,
                            "StandardCode": "B44"
                        },
                        "EXR": {
                            "Text": "Exchange rate value",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "EPL": {
                            "Text": "European Standard Pallet",
                            "UnitSpecificScale": 3,
                            "StandardCode": "OH"
                        },
                        "LDM": {
                            "Text": "Loading Meter",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        },
                        "MLL": {
                            "Text": "Mega Liter",
                            "UnitSpecificScale": 3,
                            "StandardCode": ""
                        }
                        },
                        "modelPath": "/C_PurchaseOrderItemTP(PurchaseOrder='',PurchaseOrderItem='00010',DraftUUID=guid'b3a863c7-1593-1fd0-a198-13682ac0b4f5',IsActiveEntity=false)",
                        "propertyPath": "/##@@requestUnitsOfMeasure",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderItemTP(PurchaseOrder='',PurchaseOrderItem='00010',DraftUUID=guid'b3a863c7-1593-1fd0-a198-13682ac0b4f5',IsActiveEntity=false)",
                        "modelName": "undefined",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "_templPrivGlobaleODESM_C_PurchaseOrderTP",
                        "use": false
                    },
                    {
                        "contextPath": "/ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--ItemsFacet::Table",
                        "modelName": "$cmd",
                        "use": false
                    }
                    ]
                },
                "styleClasses": [
                    "smartFieldPaddingRight",
                    "sapUiCompSmartFieldValue"
                ],
                "recordReplaySelector": {
                    "controlType": "sap.m.Input",
                    "viewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "viewId": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP",
                    "bindingPath": {
                    "path": "/C_PurchaseOrderItemTP(PurchaseOrder='',PurchaseOrderItem='00010',DraftUUID=guid'b3a863c7-1593-1fd0-a198-13682ac0b4f5',IsActiveEntity=false)",
                    "propertyPath": "OrderQuantity"
                    },
                    "value": "7",
                    "id": "__field76-__clone389-input",
                    "text": "Order Quantity"
                },
                "viewInfos": {
                    "absoluteViewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "relativeViewName": "Details"
                },
                "keyCode": 55,
                "key": "7"
                },
                {
                "id": "52499170-a2a7-4ed3-bbd0-2524f57cc422",
                "actionType": "clicked",
                "actionLocation": "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage&/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)/?sap-iapp-state--history=TASJZZCY7UQNR4G3OI2SN3ZA6TBHRKSN4WE7QT4N1",
                "control": {
                    "controlId": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--activate",
                    "use": true
                    },
                    "type": "sap.m.Button",
                    "properties": [
                    {
                        "name": "accessibleRole",
                        "value": "Default",
                        "use": false
                    },
                    {
                        "name": "activeIcon",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "ariaDescribedBy",
                        "value": [
                        "__text460"
                        ],
                        "use": false
                    },
                    {
                        "name": "ariaHasPopup",
                        "value": "None",
                        "use": false
                    },
                    {
                        "name": "ariaLabelledBy",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "blocked",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busy",
                        "value": false,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorDelay",
                        "value": 1000,
                        "use": false
                    },
                    {
                        "name": "busyIndicatorSize",
                        "value": "Medium",
                        "use": false
                    },
                    {
                        "name": "dependents",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "dragDropConfig",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "enabled",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "fieldGroupIds",
                        "value": [
                        
                        ],
                        "use": false
                    },
                    {
                        "name": "icon",
                        "value": "",
                        "use": false
                    },
                    {
                        "name": "iconDensityAware",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "iconFirst",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "id",
                        "value": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--activate",
                        "use": false
                    },
                    {
                        "name": "text",
                        "value": "Order",
                        "use": false
                    },
                    {
                        "name": "textDirection",
                        "value": "Inherit",
                        "use": false
                    },
                    {
                        "name": "type",
                        "value": "Emphasized",
                        "use": false
                    },
                    {
                        "name": "visible",
                        "value": true,
                        "use": false
                    },
                    {
                        "name": "width",
                        "value": "",
                        "use": false
                    }
                    ],
                    "bindings": [
                    {
                        "propertyName": "visible",
                        "bindingValue": true,
                        "propertyPath": "/editable",
                        "modelName": "ui",
                        "use": false
                    },
                    {
                        "propertyName": "enabled",
                        "bindingValue": true,
                        "propertyPath": "/enabled",
                        "modelName": "ui",
                        "use": false
                    },
                    {
                        "propertyName": "text",
                        "bindingValue": true,
                        "propertyPath": "/createMode",
                        "modelName": "ui",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "undefined",
                        "use": false
                    },
                    {
                        "contextPath": "/C_PurchaseOrderTP(PurchaseOrder='',DraftUUID=guid'b3a863c7-1593-1fd0-a198-10b67b0f74f5',IsActiveEntity=false)",
                        "modelName": "_templPrivGlobaleODESM_C_PurchaseOrderTP",
                        "use": false
                    },
                    {
                        "contextPath": "/ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--objectPage",
                        "modelName": "$cmd",
                        "use": false
                    }
                    ],
                    "i18nTexts": [
                    {
                        "propertyName": "text",
                        "propertyPath": "CREATE",
                        "bindingValue": "Order",
                        "use": false
                    },
                    {
                        "propertyName": "text",
                        "propertyPath": "SAVE",
                        "bindingValue": "Order",
                        "use": false
                    }
                    ]
                },
                "styleClasses": [
                    "sapMBarChild",
                    "injectClass"
                ],
                "recordReplaySelector": {
                    "id": "ui.ssuite.s2p.mm.pur.po.manage.st.s1::sap.suite.ui.generic.template.ObjectPage.view.Details::C_PurchaseOrderTP--activate",
                    "text": "Order"
                },
                "viewInfos": {
                    "absoluteViewName": "sap.suite.ui.generic.template.ObjectPage.view.Details",
                    "relativeViewName": "Details"
                }
                }
            ],
            "name": "Manage Purchase Orders",
            "ui5Version": "1.114.11"
            };

        // const input = {
        //     opa5Text: OPA5TEXT,
        //     injectHelpers: Boolean(form.getProperty("/accessToken") || true),
        //     waitEach: true,
        //     timeout: 30,
        //     poll: 200,
        //     launch: true,
        //     launchUrl: "https://qnxs4hana.quinnox.com:44300/sap/bc/ui2/flp?sap-client=100&sap-language=EN#PurchaseOrder-manage",
        //     waitAfterLaunch: true,
        //     waitAfterLaunchTime: 30,
        //     login: true,
        //     loginUser: "s4h_sd",
        //     loginPass: "Welcome1",
        //     waitAfterLogin: true,
        //     waitAfterLoginTime: 60
        // };
        console.log("Form: ", form);
        const input = {
            opa5Text: OPA5TEXT,

            // Base helpers
            injectHelpers: !!form.getProperty("/injectHelpers"),
            waitEach: !!form.getProperty("/waitEach"),
            timeout: Number(form.getProperty("/timeout") ?? 0),
            poll: Number(form.getProperty("/poll") ?? 0),

            // Launch options
            launch: Boolean(form.getProperty("/optLaunch") ?? true),
            launchUrl: String(form.getProperty("/launchUrl") ?? ""),
            waitAfterLaunch: Boolean(form.getProperty("/optWaitAfterLaunch") ?? true),
            waitAfterLaunchTime: Number(form.getProperty("/waitAfterLaunch") ?? 0),

            // Login options
            login: Boolean(form.getProperty("/optLogin") ?? true),
            loginUser: String(form.getProperty("/loginUser") ?? ""),
            loginPass: String(form.getProperty("/loginPass") ?? ""),
            waitAfterLogin: Boolean(form.getProperty("/optWaitAfterLogin") ?? true),
            waitAfterLoginTime: Number(form.getProperty("/waitAfterLogin") ?? 0),

        };

        console.log("Test function input.", input);
        const result = await Converter.convertToTestSteps(input);
        console.log("Extension Received Output: ", result);

        form.setProperty("/outJson", JSON.stringify(result.steps, null, 2));



        // end




        

        // 1) read inputs (from the model — no byId helpers)
        const appUrl = String(form.getProperty("/launchUrl") || "").trim();
        const email = String(form.getProperty("/loginUser") || "").trim();
        const pass = String(form.getProperty("/loginPass") || "");

        if (!appUrl || !email || !pass) {
            MessageToast.show("Please provide Launch URL, Login User, and Login Pass.");
            return;
        }

        // 2) config (prefer manifest.json: sap.ui5/config/{gatewayBase, gatewayToken, authPaths?})
        const comp: any = this.getOwnerComponent();
        const cfg = comp?.getManifestEntry?.("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBase || "https://stg-gateway.qyrus.com:8243/").replace(/\/+$/, "");
        const gatewayBase_2: string = (cfg.gatewayBase || "https://stg-gateway.qyrus.com:8243/").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "90540897-748a-3ef2-b3a3-c6f8f42022da";
        const authPaths: string[] = cfg.authPaths || [
            "authentication/v1/api/get-access-token",
            "authentication/api/get-access-token",
            "auth/v1/api/get-access-token"
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

        const comp: any = this.getOwnerComponent();
        const cfg = comp?.getManifestEntry?.("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBase || "https://stg-gateway.qyrus.com:8243/").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "90540897-748a-3ef2-b3a3-c6f8f42022da";

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
        const timeoutMs = Math.max(5, Number(form.getProperty("/timeout") || 30)) * 1000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let res: Response;
        let text = "";
        try {
            res = await fetch(`${url}?${params.toString()}`, { method: "GET", headers, signal: controller.signal });
            text = await res.text();
        } catch (err) {
            clearTimeout(timer);
            form.setProperty("/projects/list", []);
            form.setProperty("/projects/error", String(err));
            MessageToast.show("Network error while loading projects.");
            return;
        } finally {
            clearTimeout(timer);
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

        const comp: any = this.getOwnerComponent();
        const cfg = comp?.getManifestEntry?.("/sap.ui5/config") || {};
        const gatewayBase: string = (cfg.gatewayBase || "https://stg-gateway.qyrus.com:8243/").replace(/\/+$/, "");
        const gatewayToken: string = cfg.gatewayToken || "90540897-748a-3ef2-b3a3-c6f8f42022da";
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
        const timeoutMs = Math.max(5, Number(form.getProperty("/timeout") || 30)) * 1000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let res: Response; let text = "";
        try {
            res = await fetch(`${url}?${params.toString()}`, { method: "GET", headers, signal: controller.signal });
            text = await res.text();
        } catch (err) {
            clearTimeout(timer);
            form.setProperty("/modules/list", []);
            form.setProperty("/modules/error", String(err));
            MessageToast.show("Network error while loading modules.");
            return;
        } finally {
            clearTimeout(timer);
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
                new Text({ text: `Connect to the tab "${tab.title}" and inject analytic scripts?` })
            );
            const chkBox =
                new CheckBox({ text: 'Reload tab', selected: reload });
            chkBox.attachSelect((p1: CheckBox$SelectEvent) => {
                reload = p1.getParameter("selected");
            })
            dialogContent.addItem(
                chkBox
            );
            this._approveConnectDialog = new Dialog({
                type: DialogType.Message,
                title: 'Connect to tab',
                content: dialogContent,
                beginButton: new Button({
                    type: ButtonType.Accept,
                    text: "Connect!",
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
            ((dialogContent[0] as VBox).getItems()[0] as Text).setText(`Connect to the tab "${tab.title}" and inject analytic scripts?`);
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