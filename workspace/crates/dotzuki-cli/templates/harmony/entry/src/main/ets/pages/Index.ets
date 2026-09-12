import { preferences } from '@kit.ArkData';
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
  private lastSave: string = '';

  async startGame(context: DotzukiContext): Promise<void> {
    const pack = await getContext(this).resourceManager.getRawFileContent('game.dzpk');
    const store = await preferences.getPreferences(getContext(this), SAVE_STORE);
    const save = await store.get(SAVE_KEY, '') as string;
    if (!context.start(pack, save)) {
      throw new Error('dotzuki native runtime failed to start');
    }
    this.native = context;
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

  setButton(bit: number, pressed: boolean): void {
    if (pressed) {
      this.inputBits |= bit;
    } else {
      this.inputBits &= ~bit;
    }
    this.native?.setInput(this.inputBits);
  }

  @Builder
  button(label: string, bit: number) {
    Button(label)
      .width(label.length > 2 ? 74 : 54)
      .height(54)
      .fontSize(label.length > 2 ? 10 : 20)
      .fontWeight(FontWeight.Bold)
      .backgroundColor('#66333A4D')
      .onTouch((event: TouchEvent) => {
        this.setButton(bit, event.type === TouchType.Down || event.type === TouchType.Move);
        return true;
      })
  }

  onPageShow(): void {
    this.native?.resume();
  }

  onPageHide(): void {
    this.inputBits = 0;
    this.native?.setInput(0);
    this.native?.pause();
    this.persistSave();
  }

  aboutToDisappear(): void {
    if (this.saveTimer !== -1) clearInterval(this.saveTimer);
    this.saveTimer = -1;
    this.native?.pause();
    this.persistSave();
  }

  build() {
    Column() {
      XComponent({ id: 'dotzuki', type: XComponentType.SURFACE, libraryname: 'entry' })
        .width('100%')
        .layoutWeight(1)
        .backgroundColor(Color.Black)
        .onLoad((context) => {
          this.startGame(context as DotzukiContext);
        })

      Row() {
        Stack() {
          Row() { this.button('←', 1 << 5); this.button('→', 1 << 4) }
          Column() { this.button('↑', 1 << 6); Blank().height(38); this.button('↓', 1 << 7) }
        }
        .width(150)
        .height(150)

        Blank()

        Column() {
          Row() { this.button('SELECT', 1 << 2); this.button('START', 1 << 3) }
          Row() { this.button('B', 1 << 1); this.button('A', 1 << 0) }
        }
      }
      .width('100%')
      .padding({ left: 20, right: 20, bottom: 20 })
      .alignItems(VerticalAlign.Bottom)
      .height(200)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Color.Black)
  }
}
