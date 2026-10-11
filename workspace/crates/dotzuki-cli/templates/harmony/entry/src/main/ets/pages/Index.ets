import { preferences } from '@kit.ArkData';
import { vibrator } from '@kit.SensorServiceKit';
import { i18n } from '@kit.LocalizationKit';
import { util } from '@kit.ArkTS';
import DotzukiContext from '../types/DotzukiContext';

const SAVE_STORE = 'dotzuki-game';
const SAVE_KEY = 'save-v1';

@Entry
@Component
struct Index {
  private native: DotzukiContext | undefined;
  private inputBits: number = 0;
  private saveTimer: number = -1;
  private saving: boolean = false;
  @StorageLink('touchInsets') @Watch('configure') insets: number[] = [0, 0, 0, 0];
  @StorageLink('gameActive') @Watch('updatePlayback') active: boolean = true;
  @State editing: boolean = false;
  @State controlScale: number = 1;
  @State inset: number = 0;
  @State lift: number = 0;
  @State controlOpacity: number = 0.35;
  @State mirrored: boolean = false;
  @State floating: boolean = false;
  @State haptics: boolean = false;
  @State viewWidth: number = 0;
  @State viewHeight: number = 0;
  private visible: boolean = true;
  private canvasReady: boolean = false;
  private optionsStore: preferences.Preferences | undefined;
  private context2d: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true));
  private lastSave: string = '';

  async startGame(context: DotzukiContext): Promise<void> {
    const pack = await getContext(this).resourceManager.getRawFileContent('game.dzpk');
    const store = await preferences.getPreferences(getContext(this), SAVE_STORE);
    const save = await store.get(SAVE_KEY, '') as string;
    if (!context.start(pack, save)) {
      throw new Error('dotzuki native runtime failed to start');
    }
    this.native = context;
    this.optionsStore = await preferences.getPreferences(getContext(this), 'dotzuki-touch-v1');
    this.controlScale = this.optionsStore.getSync('scale', 1) as number;
    this.inset = this.optionsStore.getSync('inset', 0) as number;
    this.lift = this.optionsStore.getSync('lift', 0) as number;
    this.controlOpacity = this.optionsStore.getSync('opacity', 0.35) as number;
    this.mirrored = this.optionsStore.getSync('mirrored', false) as boolean;
    this.floating = this.optionsStore.getSync('floating', false) as boolean;
    this.haptics = this.optionsStore.getSync('haptics', false) as boolean;
    this.configure();
    this.updatePlayback();
    this.lastSave = save;
    if (this.saveTimer !== -1) clearInterval(this.saveTimer);
    this.saveTimer = setInterval(() => { this.persistSave(); }, 500);
  }

  async persistSave(): Promise<void> {
    if (this.saving) return;
    const bytes = this.native?.exportSave();
    if (!bytes || bytes.length === 0) {
      return;
    }
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
    const save: string = decoder.decodeToString(bytes);
    if (save === this.lastSave) return;
    this.saving = true;
    try {
      const store = await preferences.getPreferences(getContext(this), SAVE_STORE);
      await store.put(SAVE_KEY, save);
      await store.flush();
      this.lastSave = save;
    } finally { this.saving = false; }
  }

  text(en: string, zh: string): string {
    return i18n.System.getSystemLanguage().startsWith('zh') ? zh : en;
  }

  saveOptions(): void {
    this.optionsStore?.putSync('scale', this.controlScale);
    this.optionsStore?.putSync('inset', this.inset);
    this.optionsStore?.putSync('lift', this.lift);
    this.optionsStore?.putSync('opacity', this.controlOpacity);
    this.optionsStore?.putSync('mirrored', this.mirrored);
    this.optionsStore?.putSync('floating', this.floating);
    this.optionsStore?.putSync('haptics', this.haptics);
    this.optionsStore?.flush();
    this.configure();
  }

  releaseAll(): void {
    this.native?.touchEvent(3, 0, 0, 0);
    this.inputBits = 0;
    this.native?.setInput(0);
    this.drawControls();
  }

  configure(): void {
    if (!this.native || this.viewWidth <= 0 || this.viewHeight <= 0) return;
    this.releaseAll();
    const left = this.getUIContext().px2vp(this.insets[0]);
    const top = this.getUIContext().px2vp(this.insets[1]);
    const right = this.getUIContext().px2vp(this.insets[2]);
    const bottom = this.getUIContext().px2vp(this.insets[3]);
    this.native.touchConfigure([left, top, this.viewWidth - left - right,
      this.viewHeight - top - bottom, this.controlScale, this.inset, this.lift,
      this.mirrored ? 1 : 0, this.floating ? 1 : 0, this.viewHeight]);
    this.drawControls();
  }

  updatePlayback(): void {
    if (this.active && this.visible && !this.editing) this.native?.resume();
    else {
      this.releaseAll();
      this.native?.pause();
      this.persistSave();
    }
  }

  onPageShow(): void { this.visible = true; this.updatePlayback(); }
  onPageHide(): void { this.visible = false; this.updatePlayback(); }
  onBackPress(): boolean {
    if (!this.editing) return false;
    this.editing = false;
    this.releaseAll();
    this.updatePlayback();
    return true;
  }
  aboutToDisappear(): void {
    this.visible = false;
    this.updatePlayback();
    if (this.saveTimer !== -1) clearInterval(this.saveTimer);
    this.saveTimer = -1;
  }

  touch(event: TouchEvent): void {
    if (!this.native || this.editing || !this.active) return;
    if (event.type === TouchType.Cancel) { this.releaseAll(); return; }
    const kind = event.type === TouchType.Down ? 0 : event.type === TouchType.Up ? 2 : 1;
    let result = this.inputBits;
    let openSettings = false;
    // changedTouches carries the departing ID; touches does not on Up.
    for (const point of event.changedTouches) {
      result = this.native.touchEvent(kind, point.id, point.x, point.y);
      openSettings = openSettings || (result & 256) !== 0;
    }
    const next = result & 255;
    if (this.haptics && (next & ~this.inputBits) !== 0) {
      vibrator.startVibration({ type: 'time', duration: 10 }, { usage: 'touch' }).catch(() => {});
    }
    this.inputBits = next;
    this.native.setInput(next);
    this.drawControls();
    if (openSettings) {
      this.editing = true;
      this.updatePlayback();
    }
  }

  drawControls(): void {
    if (!this.canvasReady || !this.native) return;
    const ctx = this.context2d;
    ctx.clearRect(0, 0, this.viewWidth, this.viewHeight);
    const layout = this.native.touchLayout();
    for (let i = 0; i < layout.length; i += 5) {
      const id = layout[i];
      const x = layout[i + 1]; const y = layout[i + 2];
      const w = layout[i + 3]; const h = layout[i + 4];
      if (w <= 0) continue;
      const pressed = id === 8 ? (this.inputBits & 240) !== 0 : id < 8 && (this.inputBits & (1 << id)) !== 0;
      const shrink = id <= 1 ? 4 : 0;
      ctx.beginPath();
      if (id === 8 || id <= 1) ctx.arc(x + w / 2, y + h / 2, w / 2 - shrink, 0, Math.PI * 2);
      else ctx.rect(x, y + 4, w, h - 8);
      ctx.fillStyle = `rgba(17,24,35,${pressed ? 0.72 : this.controlOpacity})`;
      ctx.fill();
      ctx.strokeStyle = pressed ? '#8CDFFF' : 'rgba(225,235,245,0.6)';
      ctx.lineWidth = pressed ? 2 : 1.2;
      ctx.stroke();
      if (id === 8) {
        const labels: string[] = ['→', '←', '↑', '↓'];
        const dx: number[] = [0.31, -0.31, 0, 0];
        const dy: number[] = [0, 0, -0.31, 0.31];
        for (let n = 0; n < 4; n++) {
          this.drawLabel(labels[n], x + w / 2 + dx[n] * w, y + h / 2 + dy[n] * h,
            23, (this.inputBits & (1 << (n + 4))) !== 0);
        }
        ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(220,232,244,0.45)'; ctx.fill();
      } else {
        const title = id === 0 ? 'A' : id === 1 ? 'B' : id === 2 ? 'SELECT' : id === 3 ? 'START' : '⚙';
        this.drawLabel(title, x + w / 2, y + h / 2, id === 2 || id === 3 ? 11 : 24, pressed);
      }
    }
  }

  drawLabel(value: string, x: number, y: number, size: number, pressed: boolean): void {
    this.context2d.font = `bold ${size}vp sans-serif`;
    this.context2d.textAlign = 'center';
    this.context2d.textBaseline = 'middle';
    this.context2d.fillStyle = pressed ? '#8CDFFF' : '#F0F5FA';
    this.context2d.fillText(value, x, y);
  }

  @Builder
  settingsPanel() {
    Scroll() {
      Column({ space: 8 }) {
        Text(this.text('Touch controls', '触控布局')).fontColor('#F0F5FA').fontSize(20).fontWeight(FontWeight.Bold)
        Text(this.text('Size', '大小')).fontColor('#F0F5FA')
        Slider({ value: this.controlScale, min: 0.85, max: 1.2, step: 0.01 }).height(48)
          .onChange((value: number) => { this.controlScale = value; this.saveOptions(); })
        Text(this.text('Opacity', '不透明度')).fontColor('#F0F5FA')
        Slider({ value: this.controlOpacity, min: 0.2, max: 0.7, step: 0.01 }).height(48)
          .onChange((value: number) => { this.controlOpacity = value; this.saveOptions(); })
        Text(this.text('Move inward', '向内移动')).fontColor('#F0F5FA')
        Slider({ value: this.inset, min: 0, max: 48, step: 1 }).height(48)
          .onChange((value: number) => { this.inset = value; this.saveOptions(); })
        Text(this.text('Vertical offset', '垂直位置')).fontColor('#F0F5FA')
        Slider({ value: this.lift, min: -48, max: 48, step: 1 }).height(48)
          .onChange((value: number) => { this.lift = value; this.saveOptions(); })
        Row() {
          Text(this.text('Swap sides', '左右交换')).fontColor('#F0F5FA').layoutWeight(1)
          Toggle({ type: ToggleType.Switch, isOn: this.mirrored })
            .onChange((value: boolean) => { this.mirrored = value; this.saveOptions(); })
        }.height(48)
        Row() {
          Text(this.text('Floating direction pad', '浮动方向盘')).fontColor('#F0F5FA').layoutWeight(1)
          Toggle({ type: ToggleType.Switch, isOn: this.floating })
            .onChange((value: boolean) => { this.floating = value; this.saveOptions(); })
        }.height(48)
        Row() {
          Text(this.text('Touch feedback', '触觉反馈')).fontColor('#F0F5FA').layoutWeight(1)
          Toggle({ type: ToggleType.Switch, isOn: this.haptics })
            .onChange((value: boolean) => { this.haptics = value; this.saveOptions(); })
        }.height(48)
        Row({ space: 16 }) {
          Button(this.text('Reset', '恢复默认')).height(48).onClick(() => {
            this.controlScale = 1; this.controlOpacity = 0.35; this.inset = 0; this.lift = 0;
            this.mirrored = false; this.floating = false; this.haptics = false;
            this.saveOptions();
          })
          Button(this.text('Done', '完成')).height(48).onClick(() => {
            this.editing = false; this.releaseAll(); this.updatePlayback();
          })
        }
      }.padding(24).width('100%')
    }
    .width(Math.min(360, this.viewWidth - 48))
    .height(Math.max(120, this.viewHeight - 48))
    .backgroundColor('#F01B2433').borderRadius(20)
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      XComponent({ id: 'dotzuki', type: XComponentType.SURFACE, libraryname: 'entry' })
        .width('100%').height('100%').backgroundColor(Color.Black)
        .onLoad((context) => { this.startGame(context as DotzukiContext); })
      Canvas(this.context2d)
        .width('100%').height('100%')
        .onReady(() => { this.canvasReady = true; this.configure(); })
        .onAreaChange((_old: Area, area: Area) => {
          this.viewWidth = Number(area.width); this.viewHeight = Number(area.height); this.configure();
        })
        .onTouch((event: TouchEvent) => { this.touch(event); })
      if (this.editing) { this.settingsPanel() }
    }
    .width('100%').height('100%').backgroundColor(Color.Black)
    .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM, SafeAreaEdge.START, SafeAreaEdge.END])
  }
}
