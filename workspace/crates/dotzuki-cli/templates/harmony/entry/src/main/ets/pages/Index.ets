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

  async startGame(context: DotzukiContext): Promise<void> {
    const pack = await getContext(this).resourceManager.getRawFileContent('game.dzpk');
    const store = await preferences.getPreferences(getContext(this), SAVE_STORE);
    const save = await store.get(SAVE_KEY, '') as string;
    if (!context.start(pack, save)) {
      throw new Error('dotzuki native runtime failed to start');
    }
    this.native = context;
  }

  async persistSave(): Promise<void> {
    const bytes = this.native?.exportSave();
    if (!bytes || bytes.length === 0) {
      return;
    }
    const decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
    const save: string = decoder.decodeToString(bytes);
    const store = await preferences.getPreferences(getContext(this), SAVE_STORE);
    await store.put(SAVE_KEY, save);
    await store.flush();
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
      .width(54)
      .height(54)
      .fontSize(20)
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
    this.native?.pause();
    this.persistSave();
  }

  aboutToDisappear(): void {
    this.persistSave();
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      XComponent({ id: 'dotzuki', type: XComponentType.SURFACE, libraryname: 'entry' })
        .width('100%')
        .height('100%')
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
      .align(Alignment.Bottom)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Color.Black)
  }
}
