import { UIAbility } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

export default class EntryAbility extends UIAbility {
  private mainWindow: window.Window | undefined;

  private updateInsets = (): void => {
    if (!this.mainWindow) return;
    const types: window.AvoidAreaType[] = [window.AvoidAreaType.TYPE_SYSTEM,
      window.AvoidAreaType.TYPE_CUTOUT, window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR];
    let left = 0; let top = 0; let right = 0; let bottom = 0;
    for (const type of types) {
      const area = this.mainWindow.getWindowAvoidArea(type);
      left = Math.max(left, area.leftRect.width);
      top = Math.max(top, area.topRect.height);
      right = Math.max(right, area.rightRect.width);
      bottom = Math.max(bottom, area.bottomRect.height);
    }
    AppStorage.setOrCreate('touchInsets', [left, top, right, bottom]);
  };

  onWindowStageCreate(stage: window.WindowStage): void {
    this.mainWindow = stage.getMainWindowSync();
    AppStorage.setOrCreate('gameActive', true);
    this.mainWindow.setWindowLayoutFullScreen(true);
    this.mainWindow.setWindowSystemBarEnable([]);
    this.updateInsets();
    this.mainWindow.on('avoidAreaChange', this.updateInsets);
    stage.on('windowStageEvent', (event: window.WindowStageEventType) => {
      if (event === window.WindowStageEventType.INACTIVE || event === window.WindowStageEventType.HIDDEN) {
        AppStorage.setOrCreate('gameActive', false);
      } else if (event === window.WindowStageEventType.ACTIVE) {
        AppStorage.setOrCreate('gameActive', true);
        this.updateInsets();
      }
    });
    stage.loadContent('pages/Index');
  }

  onForeground(): void { AppStorage.setOrCreate('gameActive', true); }
  onBackground(): void { AppStorage.setOrCreate('gameActive', false); }
  onWindowStageDestroy(): void {
    this.mainWindow?.off('avoidAreaChange', this.updateInsets);
    this.mainWindow = undefined;
    AppStorage.setOrCreate('gameActive', false);
  }
}
