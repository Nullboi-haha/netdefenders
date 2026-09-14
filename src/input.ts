export class Input {
  private keys: Set<string> = new Set();
  private mouse = { x: 0, y: 0, down: false, justClicked: false };
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.key.toLowerCase());
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.key.toLowerCase());
    });

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      this.mouse.x = (e.clientX - rect.left) * scaleX;
      this.mouse.y = (e.clientY - rect.top) * scaleY;
    });
    canvas.addEventListener("mousedown", () => {
      this.mouse.down = true;
      this.mouse.justClicked = true;
    });
    canvas.addEventListener("mouseup", () => {
      this.mouse.down = false;
    });
    canvas.addEventListener("mouseleave", () => {
      this.mouse.down = false;
    });
    canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const touch = e.touches[0];
      this.mouse.x = (touch.clientX - rect.left) * scaleX;
      this.mouse.y = (touch.clientY - rect.top) * scaleY;
      this.mouse.down = true;
      this.mouse.justClicked = true;
    }, { passive: false });
    canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const touch = e.touches[0];
      this.mouse.x = (touch.clientX - rect.left) * scaleX;
      this.mouse.y = (touch.clientY - rect.top) * scaleY;
    }, { passive: false });
    canvas.addEventListener("touchend", (e) => {
      e.preventDefault();
      this.mouse.down = false;
    }, { passive: false });
  }

  isDown(key: string): boolean {
    return this.keys.has(key.toLowerCase());
  }

  isAnyDown(...keys: string[]): boolean {
    return keys.some((k) => this.isDown(k));
  }

  get mouseX(): number { return this.mouse.x; }
  get mouseY(): number { return this.mouse.y; }
  get mouseDown(): boolean { return this.mouse.down; }

  consumeClick(): boolean {
    if (this.mouse.justClicked) {
      this.mouse.justClicked = false;
      return true;
    }
    return false;
  }

  resetFrame(): void {
    this.mouse.justClicked = false;
  }
}
