import { Input } from "../input";

export class MultiplayerInput extends Input {
  private remoteMouseX = 0;
  private remoteMouseY = 0;
  private remoteClicked = false;
  private remoteKeys = new Set<string>();
  private active = false;

  setRemoteActive(active: boolean): void {
    this.active = active;
  }

  setRemoteInput(mouseX: number, mouseY: number, clicked: boolean, keys: string[]): void {
    this.remoteMouseX = mouseX;
    this.remoteMouseY = mouseY;
    this.remoteClicked = clicked;
    this.remoteKeys = new Set(keys);
  }

  override isDown(key: string): boolean {
    const k = key.toLowerCase();
    if (this.active) {
      return this.remoteKeys.has(k) || super.isDown(key);
    }
    return super.isDown(key);
  }

  override get mouseX(): number {
    if (this.active && this.remoteMouseX > 0) return this.remoteMouseX;
    return super.mouseX;
  }

  override get mouseY(): number {
    if (this.active && this.remoteMouseY > 0) return this.remoteMouseY;
    return super.mouseY;
  }

  override consumeClick(): boolean {
    if (this.active && this.remoteClicked) {
      this.remoteClicked = false;
      return true;
    }
    return super.consumeClick();
  }

  override resetFrame(): void {
    this.remoteClicked = false;
    super.resetFrame();
  }
}
