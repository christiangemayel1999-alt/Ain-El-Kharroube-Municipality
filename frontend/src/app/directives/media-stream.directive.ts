import { Directive, ElementRef, Input, OnChanges } from "@angular/core";

@Directive({
  selector: "video[appMediaStream]",
  standalone: true
})
export class MediaStreamDirective implements OnChanges {
  @Input("appMediaStream") stream: MediaStream | null = null;

  constructor(private readonly elementRef: ElementRef<HTMLVideoElement>) {}

  ngOnChanges() {
    const video = this.elementRef.nativeElement;
    if (video.srcObject !== this.stream) {
      video.srcObject = this.stream;
    }

    if (!this.stream) {
      video.pause();
      return;
    }

    void video.play().catch(() => {
      // Autoplay may be blocked by browser policy until user interaction.
    });
  }
}

