import { Component, OnInit } from "@angular/core";
import { WowInstallation } from "app/models/wowup/wow-installation";
import { ElectronService } from "app/services";
import { WarcraftInstallationService } from "app/services/warcraft/warcraft-installation.service";
import { from, Observable, of } from "rxjs";
import { catchError } from "rxjs/operators";
import { WowClientType } from "../../models/warcraft/wow-client-type";
import { WowUpReleaseChannelType } from "../../models/wowup/wowup-release-channel-type";
import { WarcraftService } from "../../services/warcraft/warcraft.service";
import { WowUpService } from "../../services/wowup/wowup.service";
import { getEnumList, getEnumName } from "../../utils/enum.utils";
import * as _ from "lodash";
import { TranslateService } from "@ngx-translate/core";
import { MatDialog } from "@angular/material/dialog";
import { AlertDialogComponent } from "../alert-dialog/alert-dialog.component";

@Component({
  selector: "app-options-wow-section",
  templateUrl: "./options-wow-section.component.html",
  styleUrls: ["./options-wow-section.component.scss"],
})
export class OptionsWowSectionComponent implements OnInit {
  public wowClientTypes: WowClientType[] = getEnumList(WowClientType).filter(
    (clientType) => clientType !== WowClientType.None
  ) as WowClientType[];

  public wowInstallations$: Observable<WowInstallation[]>;
  public wowUpReleaseChannel: WowUpReleaseChannelType;

  public wowUpReleaseChannels: {
    type: WowUpReleaseChannelType;
    name: string;
  }[] = getEnumList(WowUpReleaseChannelType).map((type: WowUpReleaseChannelType) => ({
    type,
    name: getEnumName(WowUpReleaseChannelType, type),
  }));

  constructor(
    private _dialog: MatDialog,
    private _electronService: ElectronService,
    private _warcraftService: WarcraftService,
    private _wowupService: WowUpService,
    private _warcraftInstallationService: WarcraftInstallationService,
    private _translateService: TranslateService
  ) {
    this.wowInstallations$ = _warcraftInstallationService.wowInstallations$;
  }

  ngOnInit(): void {
    this.wowUpReleaseChannel = this._wowupService.wowUpReleaseChannel;
  }

  public onReScan = (): void => {
    this._warcraftInstallationService
      .importWowInstallations(this._warcraftInstallationService.blizzardAgentPath)
      .catch((e) => console.error(e));
  };

  public onAddNew(): void {
    from(this.addNewClient())
      .pipe(
        catchError((error) => {
          console.error(error);
          return of(undefined);
        })
      )
      .subscribe();
  }

  private async addNewClient() {
    const selectedPath = await this._warcraftInstallationService.selectWowClientPath();
    if (!selectedPath) {
      return;
    }

    console.log("dialogResult", selectedPath);

    const isWowApplication = await this._warcraftService.isWowApplication(selectedPath);

    if (!isWowApplication) {
      this.showInvalidWowApplication(selectedPath);
      return;
    }

    console.log("isWowApplication", isWowApplication);

    const wowInstallation = await this._warcraftInstallationService.createWowInstallationForPath(selectedPath);
    console.log("wowInstallation", wowInstallation);

    this._warcraftInstallationService.addInstallation(wowInstallation);
  }

  private showInvalidWowApplication(selectedPath: string) {
    const dialogMessage = this._translateService.instant("DIALOGS.SELECT_INSTALLATION.INVALID_INSTALLATION_PATH", {
      selectedPath,
    });

    this.showError(dialogMessage);
  }

  private showError(message: string) {
    const title = this._translateService.instant("DIALOGS.ALERT.ERROR_TITLE");
    this._dialog.open(AlertDialogComponent, {
      data: {
        title,
        message,
      },
    });
  }
}
